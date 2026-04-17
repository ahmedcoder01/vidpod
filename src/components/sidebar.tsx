'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '@/context/app-context';
import { PodcastShow } from '@/lib/types';
import { CreatePodcastModal } from '@/components/podcast/create-podcast-modal';
import {
  LayoutDashboard, BarChart2, Radio, Layers, Download, Settings,
  ChevronDown, Users, MessageSquare, HelpCircle, ToggleLeft, Check, Plus, Loader2,
} from 'lucide-react';

const mainNav = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Analytics', href: '/analytics', icon: BarChart2 },
  { label: 'Ads', href: '/ads', icon: Radio },
  { label: 'Channels', href: '/channels', icon: Layers },
  { label: 'Import', href: '/import', icon: Download },
  { label: 'Settings', href: '/settings', icon: Settings },
];

// Fallback gradient pool — used when a podcast doesn't ship its own, so the
// sidebar badge still renders consistently.
const FALLBACK_GRADIENTS = [
  'from-orange-400 to-red-500',
  'from-indigo-400 to-purple-500',
  'from-emerald-400 to-teal-500',
  'from-pink-400 to-rose-500',
  'from-sky-400 to-blue-500',
  'from-amber-400 to-orange-500',
];

function hashIndex(str: string, mod: number) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function initialsFor(p: PodcastShow) {
  if (p.initials) return p.initials;
  const words = p.title.trim().split(/\s+/);
  return (words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '');
}

function gradientFor(p: PodcastShow) {
  return p.coverGradient ?? FALLBACK_GRADIENTS[hashIndex(p.id, FALLBACK_GRADIENTS.length)];
}

function PodcastBadge({ show, size = 20 }: { show: PodcastShow; size?: number }) {
  return (
    <div
      className={cn(
        'rounded-md bg-linear-to-br shrink-0 flex items-center justify-center',
        gradientFor(show),
      )}
      style={{ width: size, height: size }}
    >
      <span className="text-white font-bold" style={{ fontSize: Math.max(8, size * 0.4) }}>
        {initialsFor(show).toUpperCase()}
      </span>
    </div>
  );
}

function PodcastDropdown() {
  const { podcasts, currentPodcast, setCurrentPodcastId, loading } = useApp();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="px-3 pb-3 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 hover:bg-gray-50 transition rounded-lg px-2 py-1.5 text-left group"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {currentPodcast ? (
          <>
            <PodcastBadge show={currentPodcast} />
            <span className="text-gray-700 text-[11px] font-medium truncate flex-1">
              {currentPodcast.title}
            </span>
          </>
        ) : loading ? (
          <>
            <div className="w-5 h-5 rounded-md bg-gray-100 shrink-0 flex items-center justify-center">
              <Loader2 size={10} className="text-gray-400 animate-spin" />
            </div>
            <span className="text-gray-400 text-[11px] font-medium truncate flex-1">
              Loading…
            </span>
          </>
        ) : (
          <>
            <div className="w-5 h-5 rounded-md bg-gray-200 shrink-0" />
            <span className="text-gray-400 text-[11px] font-medium truncate flex-1">
              No podcasts yet
            </span>
          </>
        )}
        <ChevronDown
          size={11}
          className={cn(
            'text-gray-400 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 top-[calc(100%-2px)] z-40 bg-white border border-gray-200 rounded-xl overflow-hidden animate-fade-in"
          style={{ boxShadow: '0 12px 32px -8px rgba(0,0,0,0.18), 0 4px 12px -4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)' }}
          role="listbox"
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {podcasts.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-gray-400 text-center">
                No podcasts yet
              </div>
            ) : (
              podcasts.map((p) => {
                const active = p.id === currentPodcast?.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => { setCurrentPodcastId(p.id); setOpen(false); }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition',
                      active ? 'bg-indigo-50/60' : 'hover:bg-gray-50',
                    )}
                    role="option"
                    aria-selected={active}
                  >
                    <PodcastBadge show={p} size={22} />
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-[11px] truncate',
                        active ? 'text-indigo-700 font-semibold' : 'text-gray-800 font-medium',
                      )}>
                        {p.title}
                      </p>
                      {p.description && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">
                          {p.description}
                        </p>
                      )}
                    </div>
                    {active && <Check size={12} className="text-indigo-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-t border-gray-100 transition"
            onClick={() => { setOpen(false); setShowCreate(true); }}
          >
            <Plus size={12} className="text-gray-400" />
            Create new podcast
          </button>
        </div>
      )}

      {showCreate && <CreatePodcastModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[175px] min-w-[175px] h-screen flex flex-col bg-white border-r border-gray-100 overflow-hidden">
      {/* Logo */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          {/* Geometric logo matching Figma */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2L18 16H2L10 2Z" fill="#111827" />
          </svg>
          <span className="text-gray-900 font-semibold text-[15px] tracking-tight">Vidpod</span>
        </div>
      </div>

      {/* Create episode */}
      <div className="px-3 pb-2">
        <button className="w-full bg-gray-900 hover:bg-gray-800 text-white text-[11px] font-medium rounded-lg py-2 px-3 transition flex items-center justify-center gap-1">
          Create an episode
        </button>
      </div>

      {/* Podcast selector */}
      <PodcastDropdown />

      {/* Main nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {mainNav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[12px] transition-all group',
                active
                  ? 'text-gray-900 font-semibold'
                  : 'text-gray-500 font-medium hover:text-gray-800 hover:bg-gray-50'
              )}
            >
              <Icon
                size={14}
                className={cn('shrink-0 transition', active ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-600')}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Weekly plays widget */}
      <div className="mx-3 mb-3 bg-gray-50 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-500 text-[10px] font-medium">Weekly plays</span>
          <span className="text-emerald-500 text-[10px] font-semibold">▲ 17%</span>
        </div>
        <p className="text-gray-900 text-[15px] font-bold">738,849</p>
        <svg viewBox="0 0 80 24" className="w-full mt-1.5">
          <polyline
            points="0,20 10,18 20,13 30,15 40,7 50,10 60,5 70,8 80,3"
            fill="none"
            stroke="#22c55e"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/* Pagination dots */}
        <div className="flex items-center justify-center gap-1 mt-2">
          <div className="w-4 h-1 rounded-full bg-gray-400" />
          <div className="w-1 h-1 rounded-full bg-gray-200" />
          <div className="w-1 h-1 rounded-full bg-gray-200" />
        </div>
      </div>

      {/* Bottom nav */}
      <div className="px-2 pb-3 space-y-0.5 border-t border-gray-100 pt-2">
        <button className="w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition">
          <div className="flex items-center gap-2">
            <ToggleLeft size={13} className="text-gray-400" />
            Demo mode
          </div>
          <div className="w-7 h-4 bg-gray-200 rounded-full relative">
            <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 left-0.5 shadow-sm" />
          </div>
        </button>
        {[
          { label: 'Invite your team', icon: Users },
          { label: 'Give feedback', icon: MessageSquare },
          { label: 'Help & support', icon: HelpCircle },
        ].map(({ label, icon: Icon }) => (
          <Link
            key={label}
            href="#"
            className="flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-all"
          >
            <Icon size={13} className="text-gray-400 shrink-0" />
            {label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
