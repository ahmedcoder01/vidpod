'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    // Mock auth - just redirect to dashboard
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    router.push('/dashboard');
  }

  return (
    <div className="w-full max-w-sm animate-fade-in">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="1.5" />
              <path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="white" />
            </svg>
          </div>
          <span className="text-white text-xl font-semibold tracking-tight">Vidpod</span>
        </div>
        <h1 className="text-white text-2xl font-semibold">Welcome back</h1>
        <p className="text-zinc-400 text-sm mt-1">Sign in to your account</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 space-y-4">
        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div>
          <label className="block text-zinc-300 text-sm font-medium mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@podcast.com"
            className="w-full bg-white/8 border border-white/15 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
          />
        </div>
        <div>
          <label className="block text-zinc-300 text-sm font-medium mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-white/8 border border-white/15 rounded-lg px-3.5 py-2.5 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-sm transition-all"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-zinc-500 text-sm mt-4">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 transition">
          Sign up
        </Link>
      </p>
    </div>
  );
}
