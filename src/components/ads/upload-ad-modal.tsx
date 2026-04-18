'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ad } from '@/lib/types';
import { cn } from '@/lib/utils';
import { X, Upload, Film, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  onUploaded: (ad: Ad) => void;
  onCancel: () => void;
}

type Phase = 'form' | 'uploading' | 'finalizing' | 'error';

// Probe the file's duration via a hidden <video> element so we can send it
// up on /upload-init — the Ad row is useful even without a completion ping.
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      cleanup();
      resolve(d);
    };
    v.onerror = () => { cleanup(); resolve(0); };
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function formatSec(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function UploadAdModal({ onUploaded, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [advertiser, setAdvertiser] = useState('');
  const [campaign, setCampaign] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileDur, setFileDur] = useState(0);
  const [drag, setDrag] = useState(false);

  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState(0); // 0..1
  const [errMsg, setErrMsg] = useState<string>('');

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Esc closes (unless we're uploading — don't trash in-flight data).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'uploading' && phase !== 'finalizing') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onCancel]);

  const selectFile = useCallback(async (f: File) => {
    if (!f.type.startsWith('video/') && !f.name.toLowerCase().endsWith('.mp4')) {
      setErrMsg('Please choose an MP4 video.');
      return;
    }
    setErrMsg('');
    setFile(f);
    setFileDur(0);
    // Probe in the background — don't block the form.
    probeDuration(f).then(setFileDur);
    // If the user hasn't typed a title yet, seed it from the filename.
    if (!title) {
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (base) setTitle(base.slice(0, 80));
    }
  }, [title]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void selectFile(f);
  }

  const canSubmit = phase === 'form' && file != null && title.trim().length > 0;

  async function handleSubmit() {
    if (!file || !canSubmit) return;
    setErrMsg('');
    setProgress(0);
    setPhase('uploading');

    const tags = tagsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);

    // 1) Init — creates the pending Ad row and returns presigned PUT.
    let init;
    try {
      const res = await fetch('/api/ads/upload-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          advertiser: advertiser.trim(),
          campaign: campaign.trim(),
          duration: fileDur,
          tags,
          contentType: file.type || 'video/mp4',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `upload-init failed: ${res.status}`);
      }
      init = await res.json() as {
        adId: string;
        key: string;
        uploadUrl: string;
        requiredHeaders: Record<string, string>;
      };
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to start upload');
      setPhase('error');
      return;
    }

    // 2) PUT straight to S3 with progress. fetch() doesn't expose progress
    //    reliably yet, so XHR is still the right call.
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('PUT', init.uploadUrl, true);
        for (const [k, v] of Object.entries(init.requiredHeaders)) {
          xhr.setRequestHeader(k, v);
        }
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(ev.loaded / ev.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`S3 PUT ${xhr.status}: ${xhr.responseText.slice(0, 160)}`));
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));
        xhr.send(file);
      });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Upload failed');
      setPhase('error');
      return;
    } finally {
      xhrRef.current = null;
    }

    // 3) Complete — server HEADs the object and flips status to 'ready'.
    setPhase('finalizing');
    try {
      const res = await fetch(`/api/ads/${init.adId}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: fileDur }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `upload-complete failed: ${res.status}`);
      }
      const ad = await res.json() as Ad;
      onUploaded(ad);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to finalize upload');
      setPhase('error');
    }
  }

  function cancelUpload() {
    xhrRef.current?.abort();
  }

  const busy = phase === 'uploading' || phase === 'finalizing';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(15,15,20,0.55) 0%, rgba(8,8,12,0.72) 100%)',
        backdropFilter: 'blur(1.5px) saturate(115%)',
        WebkitBackdropFilter: 'blur(1.5px) saturate(115%)',
      }}
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md animate-slide-in flex flex-col"
        style={{
          boxShadow:
            '0 24px 64px -12px rgba(0,0,0,0.35), 0 8px 24px -6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-gray-900 font-semibold text-sm">Upload ad</h2>
            <p className="text-gray-400 text-xs mt-0.5">Add a new ad to your library</p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-gray-400 hover:text-gray-700 transition p-1 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* File drop area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => !file && !busy && fileInputRef.current?.click()}
            className={cn(
              'relative rounded-xl border-2 border-dashed transition cursor-pointer',
              drag
                ? 'border-gray-900 bg-gray-50'
                : file
                  ? 'border-gray-200 bg-gray-50'
                  : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void selectFile(f); }}
            />
            {file ? (
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-lg bg-gray-900 text-white flex items-center justify-center shrink-0">
                  <Film size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">{file.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                    {formatBytes(file.size)} · {formatSec(fileDur)}
                  </p>
                </div>
                {!busy && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); setFileDur(0); }}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-white transition"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                  <Upload size={16} className="text-gray-500" />
                </div>
                <p className="text-sm font-medium text-gray-900">Drop an MP4 here or click to browse</p>
                <p className="text-[11px] text-gray-400 mt-1">Short ads play best — up to a few minutes</p>
              </div>
            )}
          </div>

          {/* Metadata fields (hidden once we're uploading to reduce clutter) */}
          {!busy && phase !== 'error' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block">
                <span className="text-[11px] font-medium text-gray-600">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. n8n — automate anything"
                  className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 transition"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-600">Advertiser</span>
                <input
                  value={advertiser}
                  onChange={(e) => setAdvertiser(e.target.value)}
                  placeholder="n8n"
                  className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 transition"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-600">Campaign</span>
                <input
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  placeholder="Q4 launch"
                  className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 transition"
                />
              </label>
              <label className="col-span-2 block">
                <span className="text-[11px] font-medium text-gray-600">Tags <span className="text-gray-400 font-normal">(comma-separated)</span></span>
                <input
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="automation, saas"
                  className="mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 transition"
                />
              </label>
            </div>
          )}

          {/* Progress panel */}
          {(phase === 'uploading' || phase === 'finalizing') && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Loader2 size={14} className="text-gray-900 animate-spin shrink-0" />
                <p className="text-xs font-semibold text-gray-900">
                  {phase === 'uploading' ? 'Uploading to storage' : 'Finalizing'}
                </p>
                <span className="ml-auto text-[11px] text-gray-500 tabular-nums">
                  {phase === 'uploading' ? `${Math.round(progress * 100)}%` : '—'}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full bg-gray-900 transition-[width] duration-100"
                  style={{ width: `${phase === 'finalizing' ? 100 : Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'error' && errMsg && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-3">
              <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-700">Upload failed</p>
                <p className="text-[11px] text-red-600 mt-0.5 break-words">{errMsg}</p>
              </div>
            </div>
          )}

          {/* Inline errors (non-fatal, e.g. wrong file type) */}
          {phase === 'form' && errMsg && (
            <p className="text-[11px] text-red-600">{errMsg}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          {phase === 'uploading' ? (
            <>
              <button
                onClick={cancelUpload}
                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition"
              >
                Cancel upload
              </button>
            </>
          ) : phase === 'finalizing' ? (
            <span className="text-[11px] text-gray-500 px-2">Almost there…</span>
          ) : phase === 'error' ? (
            <>
              <button
                onClick={onCancel}
                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition"
              >
                Close
              </button>
              <button
                onClick={() => { setPhase('form'); setErrMsg(''); }}
                className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onCancel}
                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                <CheckCircle2 size={13} />
                Upload ad
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
