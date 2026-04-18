'use client';

import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  // Increments on every failed attempt so the error box gets a fresh
  // mount and replays its shake animation even if the message string
  // stays identical ("Invalid credentials" twice in a row).
  const errorKey = useRef(0);

  function checkCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === 'function') {
      setCapsOn(e.getModifierState('CapsLock'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      errorKey.current++;
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errorKey.current++;
        setError(data.error ?? 'Sign-in failed');
        return;
      }
      router.push(next);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card-in">
      {/* Brand */}
      <div className="flex flex-col items-center mb-8">
        <div className="auth-brand-mark w-11 h-11 rounded-xl flex items-center justify-center shadow-[0_6px_20px_rgba(99,102,241,0.35)] mb-5">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" />
            <path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="white" />
          </svg>
        </div>
        <h1 className="text-gray-900 text-[22px] font-semibold tracking-tight">Welcome back</h1>
        <p className="text-gray-500 text-[13px] mt-1">Sign in to continue to Vidpod</p>
      </div>

      {/* Card */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(0,0,0,0.06)]"
      >
        {error && (
          <div
            key={errorKey.current}
            className="auth-shake flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
            <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <line x1="12" y1="16.5" x2="12.01" y2="16.5" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Email */}
        <div>
          <label className="block text-gray-700 text-[13px] font-medium mb-1.5">Email</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@podcast.com"
              className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-gray-900 text-[13px] placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-gray-700 text-[13px] font-medium">Password</label>
            <Link href="/forgot" className="text-[12px] text-gray-500 hover:text-indigo-600 transition">
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={checkCaps}
              onKeyUp={checkCaps}
              placeholder="••••••••"
              className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-10 py-2.5 text-gray-900 text-[13px] placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {capsOn && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Caps Lock is on
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="group relative w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-[13px] transition-all flex items-center justify-center gap-1.5 active:scale-[0.99]"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      <p className="text-center text-gray-500 text-[13px] mt-5">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-indigo-600 hover:text-indigo-500 font-medium transition">
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
