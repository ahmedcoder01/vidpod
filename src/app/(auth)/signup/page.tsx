'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, Mail, Lock, User, ArrowRight, Sparkles } from 'lucide-react';

// Lightweight password strength classifier. Not cryptographic (no dictionary
// check, no zxcvbn); just a nudge so people don't pick "password1". Scores
// 0–4: 0 = empty, 1 = weak, 2 = fair, 3 = good, 4 = strong. Returns the
// single most impactful missing piece as a tip so the user has one clear
// thing to improve rather than a wall of rules.
type StrengthScore = 0 | 1 | 2 | 3 | 4;
interface Strength {
  score: StrengthScore;
  label: string;
  tip: string;
  pipClass: string;   // tailwind bg color for filled pips
  labelClass: string; // tailwind text color for the label
}
function evaluatePassword(pw: string): Strength {
  if (!pw) {
    return { score: 0, label: '', tip: '', pipClass: 'bg-gray-200', labelClass: 'text-gray-400' };
  }

  const len = pw.length;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);

  let raw = 0;
  if (len >= 8)  raw++;
  if (len >= 12) raw++;
  if (hasLower && hasUpper) raw++;
  if (hasDigit)  raw++;
  if (hasSymbol) raw++;

  // Penalise trivially weak patterns even if length is fine.
  if (/^(.)\1+$/.test(pw)) raw = 1;               // all same char
  if (/^(0?1234|abcd|qwer|pass|admin)/i.test(pw)) raw = Math.min(raw, 1);

  const score = Math.max(0, Math.min(4, raw)) as StrengthScore;

  const tip =
    len < 8        ? `${8 - len} more character${8 - len === 1 ? '' : 's'} to go`
  : !hasDigit      ? 'Sprinkle in a number'
  : !(hasLower && hasUpper) ? 'Try mixing UPPER and lower case'
  : !hasSymbol     ? 'Add a symbol for extra punch'
  : len < 12       ? 'Longer passwords are even safer'
  :                  'Rock solid';

  const [label, pipClass, labelClass] =
    score <= 1 ? ['Weak',   'bg-rose-500',    'text-rose-600']
  : score === 2 ? ['Fair',   'bg-amber-500',   'text-amber-600']
  : score === 3 ? ['Good',   'bg-emerald-500', 'text-emerald-600']
  :               ['Strong', 'bg-emerald-500', 'text-emerald-600'];

  return { score, label, tip, pipClass, labelClass };
}

function PasswordStrengthMeter({ password }: { password: string }) {
  const s = useMemo(() => evaluatePassword(password), [password]);
  if (!password) return null;

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => {
          const filled = s.score >= i;
          return (
            <div
              key={i}
              className={`h-[5px] flex-1 rounded-full transition-colors duration-250 ${
                filled ? s.pipClass : 'bg-gray-200'
              } ${filled ? 'auth-pip-pop' : ''} ${
                filled && s.score === 4 ? 'auth-pip-strong' : ''
              }`}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] flex items-center gap-1">
        <span className={`font-semibold ${s.labelClass} flex items-center gap-1`}>
          {s.label}
          {s.score === 4 && <Sparkles size={11} className="text-emerald-500" />}
        </span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">{s.tip}</span>
      </p>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const errorKey = useRef(0);

  function checkCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === 'function') {
      setCapsOn(e.getModifierState('CapsLock'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name || !email || !password) {
      errorKey.current++;
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      errorKey.current++;
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errorKey.current++;
        setError(data.error ?? 'Sign-up failed');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card-in">
      <div className="flex flex-col items-center mb-8">
        <div className="auth-brand-mark w-11 h-11 rounded-xl flex items-center justify-center shadow-[0_6px_20px_rgba(99,102,241,0.35)] mb-5">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" />
            <path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="white" />
          </svg>
        </div>
        <h1 className="text-gray-900 text-[22px] font-semibold tracking-tight">Create your account</h1>
        <p className="text-gray-500 text-[13px] mt-1">Start managing your podcast ads</p>
      </div>

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

        <div>
          <label className="block text-gray-700 text-[13px] font-medium mb-1.5">Full name</label>
          <div className="relative">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Emma Warren"
              className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-gray-900 text-[13px] placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition"
            />
          </div>
        </div>

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

        <div>
          <label className="block text-gray-700 text-[13px] font-medium mb-1.5">Password</label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={checkCaps}
              onKeyUp={checkCaps}
              placeholder="Min. 8 characters"
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
          <PasswordStrengthMeter password={password} />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="group relative w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-[13px] transition-all flex items-center justify-center gap-1.5 active:scale-[0.99]"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Creating account…
            </>
          ) : (
            <>
              Create account
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          By creating an account, you agree to our Terms and Privacy Policy.
        </p>
      </form>

      <p className="text-center text-gray-500 text-[13px] mt-5">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-600 hover:text-indigo-500 font-medium transition">
          Sign in
        </Link>
      </p>
    </div>
  );
}
