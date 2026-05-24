'use client';
import { verifyMagicLink } from '@/lib/recover/recover-client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function RecoverVerifyPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setError('This link is missing its token.');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const view = await verifyMagicLink(token);
        if (!cancelled) router.replace(`/recover/${view.sessionId}`);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return (
    <div className="py-10 text-center">
      {error ? (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
      ) : (
        <p className="text-slate-600">Verifying your link…</p>
      )}
    </div>
  );
}
