'use client';

import { useMemo, useState } from 'react';
import { Ad } from '@/lib/types';
import { cn } from '@/lib/utils';
import { X, Search, Upload, Eye, Check } from 'lucide-react';

interface Props {
  mode: 'static' | 'ab';
  ads: Ad[];
  onConfirm: (selected: Ad[]) => void;
  onCancel: () => void;
}

export function SelectAdsModal({ mode, ads, onConfirm, onCancel }: Props) {
  const [search, setSearch] = useState('');
  const [campaign, setCampaign] = useState('All Videos');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Derive campaign filter chips from the ads we actually received.
  const adCampaigns = useMemo(
    () => ['All Videos', ...Array.from(new Set(ads.map((a) => a.campaign)))],
    [ads],
  );

  const filtered = ads.filter((ad) => {
    const matchSearch = ad.title.toLowerCase().includes(search.toLowerCase()) ||
      ad.advertiser.toLowerCase().includes(search.toLowerCase());
    const matchCampaign = campaign === 'All Videos' || ad.campaign === campaign || ad.tags.includes(campaign);
    return matchSearch && matchCampaign;
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (mode === 'static') {
      next.clear();
      next.add(id);
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  }

  function handleConfirm() {
    onConfirm(ads.filter((a) => selected.has(a.id)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(15,15,20,0.55) 0%, rgba(8,8,12,0.72) 100%)',
        backdropFilter: 'blur(1.5px) saturate(115%)',
        WebkitBackdropFilter: 'blur(1.5px) saturate(115%)',
      }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg animate-slide-in flex flex-col max-h-[80vh]"
        style={{
          boxShadow:
            '0 24px 64px -12px rgba(0,0,0,0.35), 0 8px 24px -6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-zinc-900 font-semibold text-sm">
              {mode === 'ab' ? 'A/B test' : 'Select ad'}
            </h2>
            <p className="text-zinc-400 text-xs mt-0.5">
              {mode === 'ab'
                ? "Select which ads you're providing for A/B test"
                : 'Select which ad to show at this marker'}
            </p>
          </div>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-700 transition p-1 rounded-lg hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>

        {/* Search + actions */}
        <div className="px-5 pt-3 pb-2 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search here..."
                className="w-full pl-8 pr-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-indigo-400 transition"
              />
            </div>
            <button className="flex items-center gap-1.5 text-xs text-zinc-600 font-medium border border-zinc-200 rounded-lg px-3 py-2 hover:bg-zinc-50 transition">
              <Upload size={12} />
              Upload data
            </button>
            <button className="flex items-center gap-1.5 text-xs text-zinc-600 font-medium border border-zinc-200 rounded-lg px-3 py-2 hover:bg-zinc-50 transition">
              <Eye size={12} />
              Watch ads
            </button>
          </div>

          {/* Campaign filters */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {adCampaigns.map((c) => (
              <button
                key={c}
                onClick={() => setCampaign(c)}
                className={cn(
                  'shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition',
                  campaign === c
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="text-zinc-500 text-xs font-medium">Ad library</p>
        </div>

        {/* Ad list */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-1.5">
          {filtered.map((ad) => (
            <button
              key={ad.id}
              onClick={() => toggle(ad.id)}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all',
                selected.has(ad.id)
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-transparent bg-zinc-50 hover:border-zinc-200'
              )}
            >
              {/* Thumbnail */}
              <div className="w-20 h-12 rounded-lg bg-zinc-200 overflow-hidden shrink-0">
                {ad.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.thumbnail} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-zinc-900 text-xs font-medium truncate">{ad.title}</p>
                <p className="text-zinc-400 text-[11px] mt-0.5">{ad.advertiser} · {ad.tags[0]}</p>
                <p className="text-zinc-300 text-[11px]">{ad.tags[1]}</p>
              </div>
              {selected.has(ad.id) && (
                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shrink-0">
                  <Check size={11} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100">
          <button
            onClick={onCancel}
            className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-zinc-100 transition"
          >
            Cancel
          </button>
          {mode === 'ab' && (
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className="text-indigo-600 hover:text-indigo-700 text-sm font-medium px-4 py-2 rounded-lg border border-indigo-200 hover:bg-indigo-50 disabled:opacity-40 transition"
            >
              Create selection
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {mode === 'ab' ? 'Create A/B test' : 'Select ad'}
          </button>
        </div>
      </div>
    </div>
  );
}
