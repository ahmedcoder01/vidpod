'use client';

import { useRef, useState } from 'react';
import { X, ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/context/app-context';

interface Props {
  onClose: () => void;
}

const GRADIENTS: { label: string; value: string }[] = [
  { label: 'Sunset',   value: 'from-orange-400 to-red-500' },
  { label: 'Indigo',   value: 'from-indigo-400 to-purple-500' },
  { label: 'Emerald',  value: 'from-emerald-400 to-teal-500' },
  { label: 'Rose',     value: 'from-pink-400 to-rose-500' },
  { label: 'Sky',      value: 'from-sky-400 to-blue-500' },
  { label: 'Amber',    value: 'from-amber-400 to-orange-500' },
];

export function CreatePodcastModal({ onClose }: Props) {
  const { createPodcast } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [initials, setInitials] = useState('');
  const [gradient, setGradient] = useState(GRADIENTS[0].value);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    // Placeholder: just render a local preview. Real upload lands in Phase 2.
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setCoverPreview(url);
  }

  function deriveInitials(t: string): string {
    const words = t.trim().split(/\s+/);
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) { setError('Title is required'); return; }
    setSubmitting(true);
    try {
      await createPodcast({
        title: trimmed,
        description: description.trim() || undefined,
        initials: (initials || deriveInitials(trimmed)).slice(0, 3) || undefined,
        coverGradient: gradient,
        // coverArt intentionally omitted — image upload comes later.
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create podcast');
    } finally {
      setSubmitting(false);
    }
  }

  const preview = (initials || deriveInitials(title) || '??').slice(0, 3);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(15,15,20,0.55) 0%, rgba(8,8,12,0.72) 100%)',
        backdropFilter: 'blur(1.5px) saturate(115%)',
        WebkitBackdropFilter: 'blur(1.5px) saturate(115%)',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md animate-slide-in flex flex-col"
        style={{
          boxShadow:
            '0 24px 64px -12px rgba(0,0,0,0.35), 0 8px 24px -6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-zinc-900 font-semibold text-sm">Create podcast</h2>
            <p className="text-zinc-400 text-xs mt-0.5">Add a new show to your library</p>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition p-1 rounded-lg hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>

        {/* Preview + upload */}
        <div className="px-5 pt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              'w-20 h-20 rounded-xl bg-linear-to-br shrink-0 relative overflow-hidden flex items-center justify-center group',
              gradient,
            )}
          >
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-xl font-bold tracking-wider">{preview.toUpperCase()}</span>
            )}
            <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <ImagePlus size={16} className="text-white" />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </button>
          <div className="flex-1 min-w-0 text-xs text-zinc-500 leading-snug">
            <p className="text-zinc-700 font-medium text-[12px] mb-0.5">Cover image</p>
            <p>Upload a square image (optional). Image upload is wired visually only for now — the gradient + initials are what save.</p>
          </div>
        </div>

        {/* Fields */}
        <div className="px-5 pt-4 pb-2 space-y-3.5">
          {error && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className="block text-zinc-700 text-xs font-medium mb-1.5">Title <span className="text-red-500">*</span></label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Diary Of A CEO"
              maxLength={120}
              autoFocus
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 transition"
            />
          </div>

          <div>
            <label className="block text-zinc-700 text-xs font-medium mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this podcast about?"
              rows={2}
              maxLength={1000}
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 transition resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-zinc-700 text-xs font-medium mb-1.5">Initials</label>
              <input
                value={initials}
                onChange={(e) => setInitials(e.target.value.slice(0, 3).toUpperCase())}
                placeholder={deriveInitials(title) || 'DC'}
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 uppercase focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 transition tracking-wider"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-zinc-700 text-xs font-medium mb-1.5">Badge color</label>
              <div className="grid grid-cols-6 gap-1.5">
                {GRADIENTS.map((g) => (
                  <button
                    type="button"
                    key={g.value}
                    onClick={() => setGradient(g.value)}
                    className={cn(
                      'h-7 rounded-md bg-linear-to-br transition ring-offset-2',
                      g.value,
                      gradient === g.value
                        ? 'ring-2 ring-indigo-500 scale-105'
                        : 'hover:scale-105',
                    )}
                    aria-label={g.label}
                    title={g.label}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-zinc-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition flex items-center gap-1.5 min-w-[96px] justify-center"
          >
            {submitting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Creating
              </>
            ) : (
              'Create'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
