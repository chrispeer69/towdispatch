'use client';
import { bidderVerifyEmail, setBidderSession } from '@/lib/api/marketplace-client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type JSX, useEffect, useState } from 'react';

type State = { kind: 'pending' } | { kind: 'ok' } | { kind: 'error'; message: string };

export function VerifyClient({ slug }: { slug: string }): JSX.Element {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<State>({ kind: 'pending' });
  const base = `/marketplace/${encodeURIComponent(slug)}`;

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Missing verification token.' });
      return;
    }
    bidderVerifyEmail(token)
      .then((session) => {
        setBidderSession(slug, session);
        setState({ kind: 'ok' });
      })
      .catch((e: unknown) =>
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Verification failed.',
        }),
      );
  }, [token, slug]);

  return (
    <section className="max-w-sm mx-auto text-center">
      <h1 className="text-2xl font-bold tracking-tight mb-4">Email verification</h1>
      {state.kind === 'pending' && <p className="text-text-secondary-on-dark">Verifying…</p>}
      {state.kind === 'ok' && (
        <>
          <p className="text-status-success-on-dark font-semibold mb-4">
            Your email is verified. You're signed in.
          </p>
          <Link
            href={base}
            className="inline-block px-4 py-2 rounded-md bg-accent-orange text-white font-semibold"
          >
            Browse auctions
          </Link>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <p className="text-status-danger mb-4">{state.message}</p>
          <Link href={`${base}/login`} className="text-accent-orange font-semibold">
            Back to sign in
          </Link>
        </>
      )}
    </section>
  );
}
