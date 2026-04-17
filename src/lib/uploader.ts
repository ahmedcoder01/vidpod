/**
 * Browser-side multipart S3 uploader.
 *
 * Uses XMLHttpRequest because Chromium-based browsers still don't fire
 * upload-progress events reliably for `fetch` calls with streaming bodies.
 * Runs a bounded concurrency pool so big uploads don't hammer the browser
 * or the server, and surfaces a single aggregate progress callback driven
 * by `upload.onprogress` across all in-flight parts.
 */

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface UploadProgress {
  loaded: number;           // bytes sent so far (across all parts)
  total: number;            // file size in bytes
  fraction: number;         // 0..1
  speedBytesPerSec: number; // EMA-smoothed so UI doesn't jitter
  etaSeconds: number;       // remaining time at current speed
  partsDone: number;
  partsTotal: number;
  partStates: PartState[];  // one entry per part, indexed by partNumber - 1
}

export type PartState = 'pending' | 'uploading' | 'done' | 'failed';

export interface UploadPartResult {
  partNumber: number;
  etag: string;
}

export interface UploadOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: UploadProgress) => void;
}

interface PartSlice {
  partNumber: number;
  url: string;
  blob: Blob;
  size: number;
}

export async function uploadFileInParts(
  file: File,
  parts: PresignedPart[],
  partSize: number,
  opts: UploadOptions = {},
): Promise<UploadPartResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const total = file.size;

  // Slice the file into Blob views up front — cheap, no data copy.
  const slices: PartSlice[] = parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p, i) => {
      const start = i * partSize;
      const end = Math.min(start + partSize, total);
      return {
        partNumber: p.partNumber,
        url: p.url,
        blob: file.slice(start, end),
        size: end - start,
      };
    });

  // Progress accounting.
  const partLoaded = new Array<number>(slices.length).fill(0);
  const partStates = new Array<PartState>(slices.length).fill('pending');
  let partsDone = 0;

  // Speed estimation via EMA so the number in the UI doesn't jitter.
  let emaSpeed = 0;
  let lastTick = performance.now();
  let lastLoaded = 0;

  function emit(): void {
    if (!opts.onProgress) return;
    const loaded = partLoaded.reduce((a, b) => a + b, 0);
    const now = performance.now();
    const dtMs = now - lastTick;
    if (dtMs >= 200) {
      const instantSpeed = ((loaded - lastLoaded) * 1000) / Math.max(1, dtMs);
      emaSpeed = emaSpeed === 0 ? instantSpeed : emaSpeed * 0.7 + instantSpeed * 0.3;
      lastTick = now;
      lastLoaded = loaded;
    }
    const fraction = total === 0 ? 0 : Math.min(1, loaded / total);
    const etaSeconds = emaSpeed > 0 ? Math.max(0, (total - loaded) / emaSpeed) : Infinity;
    opts.onProgress({
      loaded,
      total,
      fraction,
      speedBytesPerSec: emaSpeed,
      etaSeconds,
      partsDone,
      partsTotal: slices.length,
      partStates: partStates.slice(),
    });
  }

  async function putPart(slice: PartSlice, idx: number): Promise<UploadPartResult> {
    partStates[idx] = 'uploading';
    emit();
    try {
      const { etag } = await xhrPutWithProgress({
        url: slice.url,
        body: slice.blob,
        signal: opts.signal,
        onBytes: (loaded) => {
          // Clamp; XHR sometimes reports `total` slightly off from blob.size.
          partLoaded[idx] = Math.min(loaded, slice.size);
          emit();
        },
      });
      partLoaded[idx] = slice.size;
      partStates[idx] = 'done';
      partsDone += 1;
      emit();
      return { partNumber: slice.partNumber, etag };
    } catch (err) {
      partStates[idx] = 'failed';
      emit();
      throw err;
    }
  }

  // Bounded concurrency via an index cursor — each worker pulls the next
  // pending part until the queue is drained.
  const results: UploadPartResult[] = new Array(slices.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = cursor++;
      if (i >= slices.length) return;
      results[i] = await putPart(slices[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, slices.length) }, worker);
  await Promise.all(workers);
  return results;
}

interface XhrPutArgs {
  url: string;
  body: Blob;
  signal?: AbortSignal;
  onBytes: (loaded: number) => void;
}

function xhrPutWithProgress(args: XhrPutArgs): Promise<{ etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', args.url, true);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) args.onBytes(e.loaded);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // S3 returns the part's ETag — quoted, including the quotes — in the
        // response header. Keep the quotes; CompleteMultipartUpload expects
        // the value verbatim.
        const raw = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
        if (!raw) {
          reject(new Error('S3 did not return an ETag header — check the bucket CORS (ExposeHeaders: ["ETag"])'));
          return;
        }
        resolve({ etag: raw });
      } else {
        reject(new Error(`Part PUT failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during part upload')));
    xhr.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));

    const onAbort = () => xhr.abort();
    if (args.signal) {
      if (args.signal.aborted) { xhr.abort(); return; }
      args.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.send(args.body);
  });
}

// ── Formatters used by the modal ────────────────────────────────────────
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatBytesPerSec(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '…';
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}
