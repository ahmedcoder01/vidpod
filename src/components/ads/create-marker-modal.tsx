'use client';

import { useState } from 'react';
import { AdType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { X, Zap, Lock, FlaskConical } from 'lucide-react';

interface Props {
  onSelect: (type: AdType) => void;
  onCancel: () => void;
}

const options: { type: AdType; label: string; desc: string; icon: React.ElementType; color: string }[] = [
  {
    type: 'auto',
    label: 'Auto',
    desc: 'Automatically ad insertions',
    icon: Zap,
    color: 'text-blue-500 bg-blue-50 border-blue-200',
  },
  {
    type: 'static',
    label: 'Static',
    desc: 'A marker has to be placed by hand (you select it)',
    icon: Lock,
    color: 'text-emerald-500 bg-emerald-50 border-emerald-200',
  },
  {
    type: 'ab',
    label: 'A/B test',
    desc: 'Compare the performance of test ads you select',
    icon: FlaskConical,
    color: 'text-purple-500 bg-purple-50 border-purple-200',
  },
];

export function CreateMarkerModal({ onSelect, onCancel }: Props) {
  const [selected, setSelected] = useState<AdType | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-zinc-900 font-semibold text-sm">Create ad marker</h2>
            <p className="text-zinc-400 text-xs mt-0.5">Insert a new ad marker into this episode</p>
          </div>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-700 transition p-1 rounded-lg hover:bg-zinc-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {options.map(({ type, label, desc, icon: Icon, color }) => (
            <button
              key={type}
              onClick={() => setSelected(type)}
              className={cn(
                'w-full flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all',
                selected === type
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-transparent bg-zinc-50 hover:border-zinc-200 hover:bg-zinc-100'
              )}
            >
              <div className={cn('w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5', color)}>
                <Icon size={14} />
              </div>
              <div>
                <p className="text-zinc-900 text-sm font-medium">{label}</p>
                <p className="text-zinc-400 text-xs mt-0.5">{desc}</p>
              </div>
              <div className={cn(
                'ml-auto w-4 h-4 rounded-full border-2 shrink-0 mt-1 transition',
                selected === type ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-300'
              )} />
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100">
          <button
            onClick={onCancel}
            className="text-zinc-600 hover:text-zinc-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-zinc-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            Select marker
          </button>
        </div>
      </div>
    </div>
  );
}
