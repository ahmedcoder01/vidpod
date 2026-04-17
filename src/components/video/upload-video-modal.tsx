'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FileVideo, Upload, Loader2, AlertCircle, Trash2, Check, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/context/app-context';
import {
  type PresignedPart,
  type UploadProgress,
  type PartState,
  type UploadPartResult,
  uploadFileInParts,
  formatBytes,
  formatBytesPerSec,
  formatEta,
} from '@/lib/uploader';

type StepKey = 'details' | 'file' | 'upload' | 'done';
type Direction = 'forward' | 'back';

interface InitResponse {
  videoId: string;
  uploadId: string;
  key: string;
  partSize: number;
  parts: PresignedPart[];
}

interface Props {
  initialFile?: File | null;
  onClose: () => void;
  onUploaded?: () => void;
}

export function UploadVideoModal({ initialFile, onClose, onUploaded }: Props) {
  const { currentPodcast, apiFetch } = useApp();

  // ─── Flow state ─────────────────────────────────────────────────────
  const [step, setStep] = useState<StepKey>(initialFile ? 'file' : 'details');
  const [direction, setDirection] = useState<Direction>('forward');

  // ─── Form + file state ──────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [episode, setEpisode] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [probedDuration, setProbedDuration] = useState<number | null>(null);

  // ─── Upload state ───────────────────────────────────────────────────
  const [initResp, setInitResp] = useState<InitResponse | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedUploadRef = useRef(false);

  // ─── Derived ────────────────────────────────────────────────────────
  const titleOk = title.trim().length > 0;
  const fileOk = !!file && file.type.startsWith('video/');

  // Probe the selected file's duration — best-effort, fast, no network.
  useEffect(() => {
    if (!file) { setProbedDuration(null); return; }
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.src = url;
    let settled = false;
    const cleanup = () => {
      settled = true;
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onErr);
      URL.revokeObjectURL(url);
    };
    const onMeta = () => {
      const d = v.duration;
      setProbedDuration(Number.isFinite(d) && d > 0 ? d : null);
      cleanup();
    };
    const onErr = () => { setProbedDuration(null); cleanup(); };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onErr);
    const t = setTimeout(() => { if (!settled) cleanup(); }, 5000);
    return () => { clearTimeout(t); if (!settled) cleanup(); };
  }, [file]);

  // Auto-prefill title from the filename when title is empty and a file is picked.
  useEffect(() => {
    if (file && !title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Escape closes, unless we're mid-upload (then Cancel button is the only
  // safe exit, since it aborts the multipart).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (step === 'upload') return;
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  // ─── Navigation helpers ─────────────────────────────────────────────
  function go(next: StepKey, dir: Direction) {
    setDirection(dir);
    setStep(next);
  }

  function handleClose() {
    // If the upload is live, be explicit about what closing means.
    if (step === 'upload' && abortRef.current) {
      void abortAndClose();
      return;
    }
    onClose();
  }

  // ─── S3 upload orchestration ────────────────────────────────────────
  const startUpload = useCallback(async () => {
    if (!file || startedUploadRef.current) return;
    startedUploadRef.current = true;
    setUploadError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 1) init → presigned parts
      const initRes = await apiFetch('/api/videos/upload-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          episode: episode.trim() || undefined,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
        signal: controller.signal,
      });
      if (!initRes.ok) {
        const body = await initRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Upload init failed (${initRes.status})`);
      }
      const init = (await initRes.json()) as InitResponse;
      setInitResp(init);

      // 2) upload parts → S3 directly, collecting ETags for the finalize.
      const results: UploadPartResult[] = await uploadFileInParts(
        file,
        init.parts,
        init.partSize,
        {
          concurrency: 4,
          signal: controller.signal,
          onProgress: setProgress,
        },
      );

      // 3) finalize → server calls S3 CompleteMultipartUpload (which
      // cryptographically verifies the parts exist + ETags match) and flips
      // the DB row from `pending` to `uploaded`. Transcoding + later
      // status transitions are handled by the Go worker reacting to the
      // S3 `ObjectCreated:CompleteMultipartUpload` event.
      const completeRes = await apiFetch(`/api/videos/${init.videoId}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: init.uploadId,
          key: init.key,
          parts: results,
          duration: probedDuration ?? undefined,
        }),
        signal: controller.signal,
      });
      if (!completeRes.ok) {
        const body = await completeRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Finalize failed (${completeRes.status})`);
      }

      go('done', 'forward');
      onUploaded?.();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        // User canceled — abort already handled.
        return;
      }
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(msg);
    } finally {
      abortRef.current = null;
    }
  }, [apiFetch, file, title, description, episode, probedDuration, onUploaded]);

  async function abortAndClose() {
    abortRef.current?.abort();
    if (initResp) {
      // Best-effort tell the server — don't block closing on it.
      apiFetch(`/api/videos/${initResp.videoId}/upload-abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: initResp.uploadId, key: initResp.key }),
      }).catch(() => undefined);
    }
    onClose();
  }

  // Kick the upload when we enter step 3. Effect ensures it runs exactly
  // once per mount of that step.
  useEffect(() => {
    if (step === 'upload' && !startedUploadRef.current) {
      void startUpload();
    }
  }, [step, startUpload]);

  // ─── Render ─────────────────────────────────────────────────────────
  const animationClass = direction === 'forward' ? 'step-in-right' : 'step-in-left';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(15,15,20,0.55) 0%, rgba(8,8,12,0.72) 100%)',
        backdropFilter: 'blur(1.5px) saturate(115%)',
        WebkitBackdropFilter: 'blur(1.5px) saturate(115%)',
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg animate-slide-in flex flex-col overflow-hidden"
        style={{
          boxShadow:
            '0 24px 64px -12px rgba(0,0,0,0.35), 0 8px 24px -6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-100">
          <div>
            <h2 className="text-zinc-900 font-semibold text-sm">Upload episode</h2>
            {currentPodcast && (
              <p className="text-zinc-400 text-xs mt-0.5 truncate max-w-[260px]">
                to <span className="text-zinc-600 font-medium">{currentPodcast.title}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-zinc-400 hover:text-zinc-700 transition p-1 rounded-lg hover:bg-zinc-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} />

        {/* Body */}
        <div className="px-5 py-4 min-h-[260px]">
          <div key={step} className={animationClass}>
            {step === 'details' && (
              <DetailsStep
                title={title} setTitle={setTitle}
                episode={episode} setEpisode={setEpisode}
                description={description} setDescription={setDescription}
              />
            )}
            {step === 'file' && (
              <FileStep
                file={file}
                setFile={setFile}
                probedDuration={probedDuration}
              />
            )}
            {step === 'upload' && (
              <UploadStep
                progress={progress}
                file={file}
                error={uploadError}
                onRetry={() => { startedUploadRef.current = false; setUploadError(null); startUpload(); }}
              />
            )}
            {step === 'done' && (
              <DoneStep title={title} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-zinc-100">
          <div>
            {step === 'file' && (
              <button
                type="button"
                onClick={() => go('details', 'back')}
                className="flex items-center gap-1 text-zinc-500 hover:text-zinc-800 text-sm font-medium px-2.5 py-2 rounded-lg hover:bg-zinc-50 transition"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {(step === 'details' || step === 'file') && (
              <button
                type="button"
                onClick={onClose}
                className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-zinc-100 transition"
              >
                Cancel
              </button>
            )}

            {step === 'details' && (
              <button
                type="button"
                onClick={() => go('file', 'forward')}
                disabled={!titleOk}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Continue
              </button>
            )}

            {step === 'file' && (
              <button
                type="button"
                onClick={() => go('upload', 'forward')}
                disabled={!titleOk || !fileOk}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition flex items-center gap-1.5"
              >
                <Upload size={13} />
                Start upload
              </button>
            )}

            {step === 'upload' && !uploadError && (
              <button
                type="button"
                onClick={abortAndClose}
                className="text-red-600 hover:text-red-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-50 transition"
              >
                Cancel upload
              </button>
            )}

            {step === 'upload' && uploadError && (
              <button
                type="button"
                onClick={abortAndClose}
                className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-zinc-100 transition"
              >
                Close
              </button>
            )}

            {step === 'done' && (
              <button
                type="button"
                onClick={onClose}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-components — one per step, colocated so the whole flow reads linearly.
// ═══════════════════════════════════════════════════════════════════════

const STEP_ORDER: StepKey[] = ['details', 'file', 'upload', 'done'];

function StepIndicator({ step }: { step: StepKey }) {
  const idx = STEP_ORDER.indexOf(step);
  return (
    <div className="flex items-center justify-center gap-1.5 py-3 border-b border-zinc-50">
      {STEP_ORDER.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <div
            key={s}
            className={cn(
              'h-1.5 rounded-full transition-all duration-400',
              active
                ? 'w-8 bg-indigo-500'
                : done
                ? 'w-4 bg-indigo-300'
                : 'w-4 bg-zinc-200',
            )}
            style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.8, 0.3, 1)' }}
          />
        );
      })}
    </div>
  );
}

function DetailsStep({
  title, setTitle, episode, setEpisode, description, setDescription,
}: {
  title: string; setTitle: (s: string) => void;
  episode: string; setEpisode: (s: string) => void;
  description: string; setDescription: (s: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-zinc-700 text-xs font-medium mb-1.5">
          Episode title <span className="text-red-500">*</span>
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Meet Steven Bartlett"
          maxLength={200}
          className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 transition"
        />
      </div>
      <div>
        <label className="block text-zinc-700 text-xs font-medium mb-1.5">Episode number</label>
        <input
          value={episode}
          onChange={(e) => setEpisode(e.target.value)}
          placeholder="S1:E1"
          maxLength={40}
          className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 transition"
        />
      </div>
      <div>
        <label className="block text-zinc-700 text-xs font-medium mb-1.5">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this episode about?"
          rows={3}
          maxLength={2000}
          className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 transition resize-none"
        />
        <p className="text-[10px] text-zinc-400 mt-1 text-right">{description.length} / 2000</p>
      </div>
    </div>
  );
}

function FileStep({
  file, setFile, probedDuration,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  probedDuration: number | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    const f = list[0];
    if (!f.type.startsWith('video/')) return;
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  if (file) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-4 rounded-xl border border-zinc-200 bg-zinc-50/60">
          <div className="w-11 h-11 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
            <FileVideo size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-900 truncate">{file.name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {formatBytes(file.size)}
              {probedDuration != null && (
                <> · {formatDuration(probedDuration)}</>
              )}
              <> · {file.type || 'video'}</>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="text-zinc-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition"
            aria-label="Remove file"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <p className="text-[11px] text-zinc-400">
          The file will be uploaded directly to S3 in parallel parts. You can cancel any time before it finishes.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
          dragging
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50/40',
        )}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center">
            <Upload size={22} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-zinc-800 font-medium text-sm">Drop your video here</p>
            <p className="text-zinc-400 text-xs mt-0.5">or click to browse · MP4, MOV, WebM · up to 5 GiB</p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

function UploadStep({
  progress, file, error, onRetry,
}: {
  progress: UploadProgress | null;
  file: File | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center text-center py-6 space-y-3">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
          <AlertCircle size={26} className="text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-900">Upload failed</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm">{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          Try again
        </button>
      </div>
    );
  }

  const fraction = progress?.fraction ?? 0;
  const pct = Math.round(fraction * 100);

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center">
        <ProgressRing fraction={fraction} />
        <p className="text-zinc-800 font-medium text-sm mt-3 truncate max-w-full">
          {file?.name ?? 'Uploading…'}
        </p>
        <p className="text-[11px] text-zinc-400 tabular-nums mt-0.5">
          {progress
            ? <>{formatBytes(progress.loaded)} / {formatBytes(progress.total)} · {formatBytesPerSec(progress.speedBytesPerSec)} · {formatEta(progress.etaSeconds)}</>
            : <>Initializing upload…</>
          }
        </p>
      </div>

      {/* Parts grid */}
      {progress && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Parts</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{progress.partsDone} / {progress.partsTotal}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {progress.partStates.map((state, i) => (
              <PartDot key={i} state={state} />
            ))}
          </div>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {pct}% uploaded
      </div>
    </div>
  );
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, fraction)));
  return (
    <div className="relative w-28 h-28 progress-shimmer">
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle
          cx="56" cy="56" r={r}
          fill="none"
          stroke="#eef2ff"
          strokeWidth="8"
        />
        <circle
          cx="56" cy="56" r={r}
          fill="none"
          stroke="url(#progressGradient)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 56 56)"
          style={{ transition: 'stroke-dashoffset 220ms cubic-bezier(0.25,0.8,0.3,1)' }}
        />
        <defs>
          <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-semibold text-zinc-900 tabular-nums">
          {Math.round(fraction * 100)}
          <span className="text-sm text-zinc-400 ml-0.5">%</span>
        </span>
      </div>
    </div>
  );
}

function PartDot({ state }: { state: PartState }) {
  const color =
    state === 'done'      ? 'bg-emerald-500' :
    state === 'uploading' ? 'bg-indigo-400'  :
    state === 'failed'    ? 'bg-red-500'     :
                            'bg-zinc-200';
  const pulse = state === 'uploading';
  const popOnDone = state === 'done';
  return (
    <div
      className={cn(
        'w-2.5 h-2.5 rounded-full transition-colors',
        color,
        pulse && 'animate-pulse',
        popOnDone && 'part-fill',
      )}
    />
  );
}

function DoneStep({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center text-center py-8 space-y-4">
      <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="#10b981" opacity="0.15" />
          <path
            d="M10 16.5l4 4 8-9"
            fill="none"
            stroke="#059669"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="checkmark-draw"
            style={{ strokeDasharray: 28, ['--len' as string]: 28 } as React.CSSProperties}
          />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-900">Upload complete</p>
        <p className="text-xs text-zinc-500 mt-1 max-w-xs">
          <span className="font-medium text-zinc-700">{title}</span> is now in your library. We&apos;ll
          process it in the background and it will show up as
          <span className="font-medium text-zinc-700"> Ready</span> when transcoding finishes.
        </p>
      </div>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
