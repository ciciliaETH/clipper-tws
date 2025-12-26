'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      router.push('/leaderboard');
    } catch (err) {
      setError('Terjadi kesalahan saat login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background decorations */}
  <div aria-hidden className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-gradient-to-tr from-blue-600/30 to-sky-400/30 blur-3xl" />
  <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-gradient-to-tr from-sky-500/20 to-blue-600/20 blur-3xl" />

      <div className="relative z-10 flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-md glow-border rounded-2xl p-0">
          <div className="glass rounded-2xl p-8">
            <div className="mb-8">
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10">
                  <Image
                    src="/logo.png"
                    alt="Trade With Suli"
                    width={40}
                    height={40}
                    className="w-10 h-10 object-contain"
                    priority
                  />
                </div>
                <h1 className="text-xl font-semibold tracking-tight"><span className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">Trade With Suli</span></h1>
                <span className="hidden md:inline-flex text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/60">Clipper</span>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="your@email.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <div className="border border-red-500/30 text-red-300 px-4 py-3 rounded-xl bg-red-500/10">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 bg-gradient-to-r from-blue-600 to-sky-500 text-white disabled:from-white/10 disabled:to-white/10 disabled:text-white/40 transition shadow-lg shadow-blue-600/20"
              >
                {loading ? 'Loading...' : 'Login'}
              </button>
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}
