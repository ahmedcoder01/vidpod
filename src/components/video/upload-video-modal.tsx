'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FileVideo, Upload, Loader2, AlertCircle, Trash2, ArrowLeft, Check,
  Gauge, Timer, HardDrive, Layers,
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

const STEP_ORDER: StepKey[] = ['details', 'file', 'upload', 'done'];

// Copy shown in the sidebar + page header for each step. Keeping them in one
// place so the left rail and the content header can't drift apart.
const STEP_META: Record<StepKey, { label: string; sub: string; hint: string }> = {
  details: {
    label: 'Episode details',
    sub: 'Title, number, description',
    hint: 'Basic info for your new episode.',
  },
  file: {
    label: 'Choose file',
    sub: 'Pick the video to upload',
    hint: 'MP4, MOV, or WebM — up to 5 GiB.',
  },
  upload: {
    label: 'Uploading',
    sub: 'Streaming to S3 in parts',
    hint: 'Parallel multipart upload. Don\u2019t close this tab.',
  },
  done: {
    label: 'Done',
    sub: 'Your episode is live',
    hint: 'Transcoding continues in the background.',
  },
};

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

  // Tracks upload elapsed time (for the stats panel). Starts when the
  // upload step first renders and stops once we reach done/error.
  const uploadStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

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

  // Tick elapsed-time for the upload stats panel.
  useEffect(() => {
    if (step !== 'upload') { uploadStartRef.current = null; return; }
    if (uploadStartRef.current == null) uploadStartRef.current = Date.now();
    const id = window.setInterval(() => {
      if (uploadStartRef.current != null) {
        setElapsedMs(Date.now() - uploadStartRef.current);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [step]);

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

  // Kick the upload when we enter step 3.
  useEffect(() => {
    if (step === 'upload' && !startedUploadRef.current) {
      void startUpload();
    }
  }, [step, startUpload]);

  // ─── Render ─────────────────────────────────────────────────────────
  const animationClass = direction === 'forward' ? 'step-in-right' : 'step-in-left';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 animate-fade-in"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(15,15,20,0.62) 0%, rgba(8,8,12,0.78) 100%)',
        backdropFilter: 'blur(2px) saturate(120%)',
        WebkitBackdropFilter: 'blur(2px) saturate(120%)',
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-[1100px] animate-slide-in flex overflow-hidden"
        style={{
          height: 'min(88vh, 820px)',
          minHeight: 620,
          boxShadow:
            '0 32px 80px -16px rgba(0,0,0,0.45), 0 12px 32px -8px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)',
        }}
      >
        {/* ─── Left sidebar: vertical stepper ─────────────────────────── */}
        <aside className="w-[280px] shrink-0 bg-linear-to-br from-zinc-50 to-zinc-100/60 border-r border-zinc-200/70 flex flex-col">
          <div className="px-6 pt-7 pb-5 border-b border-zinc-200/60">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L18 16H2L10 2Z" fill="#111827" />
              </svg>
              <span className="text-zinc-900 font-semibold text-[15px] tracking-tight">
                Upload episode
              </span>
            </div>
            {currentPodcast && (
              <p className="text-zinc-500 text-[11px] mt-1.5 truncate">
                to <span className="text-zinc-800 font-medium">{currentPodcast.title}</span>
              </p>
            )}
          </div>
          <nav className="flex-1 px-4 py-5">
            <VerticalStepper step={step} />
          </nav>
          <div className="px-5 py-4 border-t border-zinc-200/60">
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Files upload directly to S3 in parallel parts. Processing continues
              in the background after the upload completes.
            </p>
          </div>
        </aside>

        {/* ─── Main column ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <header className="flex items-start justify-between px-8 pt-7 pb-5 border-b border-zinc-100">
            <div>
              <h2 className="text-zinc-900 font-semibold text-[17px] tracking-tight">
                {STEP_META[step].label}
              </h2>
              <p className="text-zinc-500 text-[12px] mt-0.5">
                {STEP_META[step].hint}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="text-zinc-400 hover:text-zinc-800 transition p-2 rounded-lg hover:bg-zinc-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div key={step} className={cn('px-8 py-7 h-full', animationClass)}>
              {step === 'details' && (
                <DetailsStep
                  title={title} setTitle={setTitle}
                  episode={episode} setEpisode={setEpisode}
                  description={description} setDescription={setDescription}
                  podcastTitle={currentPodcast?.title ?? null}
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
                  elapsedMs={elapsedMs}
                  onRetry={() => {
                    startedUploadRef.current = false;
                    uploadStartRef.current = null;
                    setElapsedMs(0);
                    setUploadError(null);
                    startUpload();
                  }}
                />
              )}
              {step === 'done' && (
                <DoneStep title={title} file={file} elapsedMs={elapsedMs} />
              )}
            </div>
          </div>

          <footer className="flex items-center justify-between gap-2 px-8 py-4 border-t border-zinc-100 bg-zinc-50/40">
            <div>
              {step === 'file' && (
                <button
                  type="button"
                  onClick={() => go('details', 'back')}
                  className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-white transition"
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
                  className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-white transition"
                >
                  Cancel
                </button>
              )}

              {step === 'details' && (
                <button
                  type="button"
                  onClick={() => go('file', 'forward')}
                  disabled={!titleOk}
                  className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition"
                >
                  Continue
                </button>
              )}

              {step === 'file' && (
                <button
                  type="button"
                  onClick={() => go('upload', 'forward')}
                  disabled={!titleOk || !fileOk}
                  className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition flex items-center gap-1.5"
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
                  className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-white transition"
                >
                  Close
                </button>
              )}

              {step === 'done' && (
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
                >
                  Done
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Vertical stepper — replaces the old dot indicator. Shows the numbered
// flow with progress connectors in the left rail.
// ═══════════════════════════════════════════════════════════════════════
function VerticalStepper({ step }: { step: StepKey }) {
  const idx = STEP_ORDER.indexOf(step);
  return (
    <ol className="space-y-1">
      {STEP_ORDER.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        const isLast = i === STEP_ORDER.length - 1;
        return (
          <li key={s} className="relative">
            <div className="flex items-start gap-3 px-2 py-2">
              <div className="relative flex flex-col items-center shrink-0">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all duration-400',
                    active && 'bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-[0_4px_12px_-2px_rgba(99,102,241,0.45)]',
                    done && 'bg-emerald-500 text-white',
                    !active && !done && 'bg-white text-zinc-400 border border-zinc-200',
                  )}
                  style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.8, 0.3, 1)' }}
                >
                  {done ? <Check size={13} /> : i + 1}
                </div>
                {!isLast && (
                  <div
                    className={cn(
                      'w-[2px] flex-1 min-h-[24px] mt-1 transition-colors duration-400',
                      done ? 'bg-emerald-400' : 'bg-zinc-200',
                    )}
                  />
                )}
              </div>
              <div className="pt-0.5 pb-3 min-w-0">
                <p
                  className={cn(
                    'text-[12.5px] transition-colors',
                    active ? 'text-zinc-900 font-semibold' : done ? 'text-zinc-700 font-medium' : 'text-zinc-500 font-medium',
                  )}
                >
                  {STEP_META[s].label}
                </p>
                <p className="text-[10.5px] text-zinc-400 mt-0.5 leading-snug">
                  {STEP_META[s].sub}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step 1 — Details. Two-column: inputs on the left, a live preview card
// on the right so the user sees what the episode row will look like.
// ═══════════════════════════════════════════════════════════════════════
function DetailsStep({
  title, setTitle, episode, setEpisode, description, setDescription, podcastTitle,
}: {
  title: string; setTitle: (s: string) => void;
  episode: string; setEpisode: (s: string) => void;
  description: string; setDescription: (s: string) => void;
  podcastTitle: string | null;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
      <div className="space-y-5">
        <div>
          <label className="block text-zinc-700 text-[12px] font-semibold mb-1.5">
            Episode title <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Meet Steven Bartlett"
            maxLength={200}
            className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/5 transition"
          />
          <p className="text-[11px] text-zinc-400 mt-1.5">Shown as the episode title in your library.</p>
        </div>
        <div>
          <label className="block text-zinc-700 text-[12px] font-semibold mb-1.5">Episode number</label>
          <input
            value={episode}
            onChange={(e) => setEpisode(e.target.value)}
            placeholder="S1:E1"
            maxLength={40}
            className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/5 transition"
          />
          <p className="text-[11px] text-zinc-400 mt-1.5">Optional — helps you group episodes by season.</p>
        </div>
        <div>
          <label className="block text-zinc-700 text-[12px] font-semibold mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this episode about?"
            rows={4}
            maxLength={2000}
            className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/5 transition resize-none"
          />
          <p className="text-[10.5px] text-zinc-400 mt-1 text-right tabular-nums">{description.length} / 2000</p>
        </div>
      </div>

      {/* Preview card */}
      <aside className="hidden lg:block">
        <div className="sticky top-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
            Preview
          </p>
          <div className="bg-linear-to-br from-zinc-50 to-white border border-zinc-200 rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_8px_24px_-8px_rgba(0,0,0,0.04)]">
            <div className="aspect-video rounded-xl bg-linear-to-br from-zinc-800 to-zinc-950 flex items-center justify-center mb-4">
              <FileVideo size={28} className="text-white/60" />
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              {episode && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5">
                  {episode}
                </span>
              )}
              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                Pending
              </span>
            </div>
            <p className="text-[13.5px] font-semibold text-zinc-900 leading-snug line-clamp-2">
              {title || 'Untitled episode'}
            </p>
            {podcastTitle && (
              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{podcastTitle}</p>
            )}
            {description && (
              <p className="text-[11.5px] text-zinc-500 mt-3 line-clamp-3 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step 2 — File picker. Full-height drop zone when empty, rich metadata
// card when a file is selected.
// ═══════════════════════════════════════════════════════════════════════
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
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="relative overflow-hidden bg-linear-to-br from-zinc-50 to-white border border-zinc-200 rounded-2xl p-6">
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 text-white flex items-center justify-center shrink-0 shadow-[0_6px_16px_-4px_rgba(0,0,0,0.3)]">
              <FileVideo size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-zinc-900 break-words">{file.name}</p>
              <p className="text-[11.5px] text-zinc-500 mt-1">{file.type || 'video/*'}</p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-zinc-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition"
              aria-label="Remove file"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-6">
            <StatTile label="Size" value={formatBytes(file.size)} />
            <StatTile
              label="Duration"
              value={probedDuration != null ? formatDuration(probedDuration) : '—'}
            />
            <StatTile label="Format" value={(file.name.split('.').pop() ?? 'video').toUpperCase()} />
          </div>
        </div>

        <div className="bg-zinc-50 border border-zinc-200/70 rounded-xl px-4 py-3 flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-white border border-zinc-200 flex items-center justify-center shrink-0 mt-0.5">
            <Upload size={13} className="text-zinc-600" />
          </div>
          <p className="text-[11.5px] text-zinc-600 leading-relaxed">
            This file will be uploaded directly to S3 in parallel multipart chunks.
            You can cancel any time before it finishes without leaving a trace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'w-full max-w-2xl border-2 border-dashed rounded-3xl px-10 py-16 text-center cursor-pointer transition-all',
          dragging
            ? 'border-zinc-900 bg-zinc-50 scale-[1.01]'
            : 'border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50/60',
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-3xl bg-zinc-900 flex items-center justify-center shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)]">
            <Upload size={30} className="text-white" />
          </div>
          <div>
            <p className="text-zinc-900 font-semibold text-[16px]">Drop your video here</p>
            <p className="text-zinc-500 text-[12.5px] mt-1.5">
              or click to browse · MP4, MOV, WebM · up to 5 GiB
            </p>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <FormatBadge>MP4</FormatBadge>
            <FormatBadge>MOV</FormatBadge>
            <FormatBadge>WebM</FormatBadge>
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

function FormatBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-100 border border-zinc-200 rounded-md px-2 py-0.5">
      {children}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-zinc-200/80 rounded-xl px-3 py-2.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>
      <p className="text-[13px] font-semibold text-zinc-900 mt-0.5 tabular-nums truncate">
        {value}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step 3 — Upload dashboard. Hero ring + stat cards + parts grid.
// ═══════════════════════════════════════════════════════════════════════
function UploadStep({
  progress, file, error, elapsedMs, onRetry,
}: {
  progress: UploadProgress | null;
  file: File | null;
  error: string | null;
  elapsedMs: number;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-center h-full space-y-4 py-12">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
          <AlertCircle size={30} className="text-red-500" />
        </div>
        <div>
          <p className="text-[15px] font-semibold text-zinc-900">Upload failed</p>
          <p className="text-[12.5px] text-zinc-500 mt-1.5 max-w-md leading-relaxed">{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          Try again
        </button>
      </div>
    );
  }

  const fraction = progress?.fraction ?? 0;
  const pct = Math.round(fraction * 100);
  const initializing = !progress;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 h-full">
      {/* Left: progress ring + file header + parts */}
      <div className="flex flex-col gap-6 min-w-0">
        <div className="flex items-center gap-5">
          <ProgressRing fraction={fraction} />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              {initializing ? 'Initializing' : 'Uploading'}
            </p>
            <p className="text-[16px] font-semibold text-zinc-900 truncate">
              {file?.name ?? 'video file'}
            </p>
            <p className="text-[12px] text-zinc-500 mt-1 tabular-nums">
              {progress
                ? <>{formatBytes(progress.loaded)} of {formatBytes(progress.total)}</>
                : 'Preparing multipart upload\u2026'}
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
              Parts
            </p>
            <span className="text-[10.5px] text-zinc-500 tabular-nums font-medium">
              {progress ? <>{progress.partsDone} / {progress.partsTotal} complete</> : '—'}
            </span>
          </div>
          <div className="flex-1 bg-zinc-50 border border-zinc-200/70 rounded-2xl p-4 overflow-y-auto min-h-[160px]">
            {progress ? (
              <div className="flex flex-wrap gap-1.5">
                {progress.partStates.map((state, i) => (
                  <PartDot key={i} state={state} />
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <Loader2 size={18} className="text-zinc-400 animate-spin" />
              </div>
            )}
          </div>
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {pct}% uploaded
        </div>
      </div>

      {/* Right: stats panel */}
      <aside className="space-y-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
          Live stats
        </p>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Gauge}
            label="Speed"
            value={progress ? formatBytesPerSec(progress.speedBytesPerSec) : '—'}
          />
          <StatCard
            icon={Timer}
            label="ETA"
            value={progress ? formatEta(progress.etaSeconds) : '—'}
          />
          <StatCard
            icon={HardDrive}
            label="Uploaded"
            value={progress ? formatBytes(progress.loaded) : '—'}
          />
          <StatCard
            icon={Layers}
            label="Parts"
            value={progress ? `${progress.partsDone}/${progress.partsTotal}` : '—'}
          />
        </div>
        <div className="bg-white border border-zinc-200/70 rounded-2xl px-4 py-4 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
              Elapsed
            </span>
            <span className="text-[14px] font-semibold text-zinc-900 tabular-nums">
              {formatElapsed(elapsedMs)}
            </span>
          </div>
          <div className="h-[1px] bg-zinc-100 my-3" />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
              Concurrency
            </span>
            <span className="text-[12.5px] font-medium text-zinc-700 tabular-nums">
              4 parts in parallel
            </span>
          </div>
          <div className="h-[1px] bg-zinc-100 my-3" />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
              Destination
            </span>
            <span className="text-[12.5px] font-medium text-zinc-700">S3 multipart</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white border border-zinc-200/70 rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={11} className="text-zinc-400" />
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-400">
          {label}
        </span>
      </div>
      <p className="text-[15px] font-semibold text-zinc-900 tabular-nums truncate">{value}</p>
    </div>
  );
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 58;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, fraction)));
  return (
    <div className="relative w-36 h-36 shrink-0 progress-shimmer">
      <svg width="144" height="144" viewBox="0 0 144 144">
        <circle
          cx="72" cy="72" r={r}
          fill="none"
          stroke="#f4f4f5"
          strokeWidth="9"
        />
        <circle
          cx="72" cy="72" r={r}
          fill="none"
          stroke="url(#progressGradient)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 72 72)"
          style={{ transition: 'stroke-dashoffset 220ms cubic-bezier(0.25,0.8,0.3,1)' }}
        />
        <defs>
          <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-semibold text-zinc-900 tabular-nums leading-none">
          {Math.round(fraction * 100)}
          <span className="text-[14px] text-zinc-400 ml-0.5 font-medium">%</span>
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

// ═══════════════════════════════════════════════════════════════════════
// Step 4 — Done. Celebration state with a summary card.
// ═══════════════════════════════════════════════════════════════════════
function DoneStep({
  title, file, elapsedMs,
}: {
  title: string;
  file: File | null;
  elapsedMs: number;
}) {
  const size = useMemo(() => (file ? formatBytes(file.size) : '—'), [file]);
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-xl w-full text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5">
          <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
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
        <p className="text-[18px] font-semibold text-zinc-900">Upload complete</p>
        <p className="text-[12.5px] text-zinc-500 mt-2 max-w-md mx-auto leading-relaxed">
          <span className="font-medium text-zinc-800">{title || 'Your episode'}</span> is now
          in your library. We&apos;ll process it in the background and mark it{' '}
          <span className="font-medium text-emerald-700">Ready</span> when transcoding finishes.
        </p>

        <div className="grid grid-cols-3 gap-3 mt-8 text-left">
          <StatTile label="Size" value={size} />
          <StatTile label="Upload time" value={formatElapsed(elapsedMs)} />
          <StatTile label="Status" value="Queued" />
        </div>
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

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
