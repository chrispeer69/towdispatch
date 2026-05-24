'use client';
import { bidderLogin, setBidderSession } from '@/lib/api/marketplace-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';

export function LoginClient({ slug }: { slug: string }): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/marketplace/${encodeURIComponent(slug)}`;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await bidderLogin({ tenantSlug: slug, email: email.trim(), password });
      setBidderSession(slug, session);
      router.push(base);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Sign in failed.');
      setBusy(false);
    }
  }

  return (
    <section className="max-w-sm mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Sign in to bid</h1>
      {error && (
        <p className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
          {error}
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <input
          className={inputCls}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          className={inputCls}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-4 text-sm text-text-secondary-on-dark">
        New bidder?{' '}
        <Link href={`${base}/register`} className="text-accent-orange font-semibold">
          Create an account
        </Link>
      </p>
    </section>
  );
}
