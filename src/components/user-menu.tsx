'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings as SettingsIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Stable gradient per user so the avatar colour doesn't flicker between
// navigations. We hash the user id (or email fallback) into the pool.
const GRADIENTS = [
  'from-purple-400 to-pink-500',
  'from-indigo-400 to-sky-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-red-500',
  'from-cyan-400 to-blue-500',
];

function hashIndex(str: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function initialsFor(name: string | undefined, email: string | undefined): string {
  const src = (name?.trim() || email?.trim() || '?').trim();
  if (!src) return '?';
  if (src.includes('@')) return src[0]!.toUpperCase();
  const parts = src.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src[0]!.toUpperCase();
}

interface MeResponse {
  user: { id: string; email: string; name: string; avatar: string | null } | null;
}

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<MeResponse['user']>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as MeResponse;
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoadingMe(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Network errors are non-fatal — we still route away so a broken session
      // cookie on the client doesn't trap the user in a logged-in UI.
    }
    // Hard replace so cached RSC/CSR state for protected pages is dropped.
    router.replace('/login');
    router.refresh();
  }, [loggingOut, router]);

  const name = user?.name ?? '';
  const email = user?.email ?? '';
  const initials = initialsFor(name, email);
  const gradient = GRADIENTS[hashIndex(user?.id ?? email ?? 'anon', GRADIENTS.length)];

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loadingMe || !user}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1.5 transition disabled:opacity-60 disabled:cursor-default"
      >
        <div
          className={cn(
            'w-6 h-6 rounded-full bg-linear-to-br flex items-center justify-center text-white text-[11px] font-bold shrink-0',
            gradient,
          )}
        >
          {loadingMe ? <Loader2 size={10} className="animate-spin" /> : initials}
        </div>
        <span className="text-gray-700 text-sm font-medium max-w-[140px] truncate">
          {loadingMe ? 'Loading…' : (name || email || 'Guest')}
        </span>
        <ChevronDown
          size={13}
          className={cn('text-gray-400 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && user && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-60 bg-white border border-gray-200 rounded-xl overflow-hidden animate-fade-in"
          style={{ boxShadow: '0 12px 32px -8px rgba(0,0,0,0.18), 0 4px 12px -4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)' }}
        >
          <div className="px-3.5 py-3 border-b border-gray-100 flex items-center gap-2.5">
            <div
              className={cn(
                'w-9 h-9 rounded-full bg-linear-to-br flex items-center justify-center text-white text-[13px] font-bold shrink-0',
                gradient,
              )}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-gray-900 truncate">{name || 'Unnamed'}</p>
              <p className="text-xs text-gray-500 truncate">{email}</p>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition"
              role="menuitem"
            >
              <SettingsIcon size={13} className="text-gray-400" />
              Account settings
            </Link>
          </div>

          <div className="py-1 border-t border-gray-100">
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-red-600 hover:bg-red-50 transition disabled:opacity-60 disabled:cursor-wait"
              role="menuitem"
            >
              {loggingOut ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <LogOut size={13} />
              )}
              {loggingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
