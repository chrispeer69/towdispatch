'use client';

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Status = 'pending' | 'success' | 'error';

export function VerifyEmailRunner(): JSX.Element {
  const params = useSearchParams();
  const token = params?.get('token') ?? '';
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!token) {
        if (!cancelled) {
          setStatus('error');
          setMessage('Missing verification token in the link.');
        }
        return;
      }
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!cancelled) {
          if (res.ok) {
            setStatus('success');
          } else {
            const data = (await res.json().catch(() => null)) as { message?: string } | null;
            setStatus('error');
            setMessage(data?.message ?? 'Verification link is invalid or has expired.');
          }
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('Could not reach the server. Try again in a moment.');
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === 'pending') {
    return <p className="text-sm text-text-secondary-on-dark">Confirming your email…</p>;
  }
  if (status === 'success') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary-on-dark">
          Your email is confirmed. Welcome aboard.
        </p>
        <Link href="/dashboard">
          <Button size="lg" className="w-full">
            Continue to dashboard
          </Button>
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
        {message}
      </div>
      <Link href="/verify-email-pending">
        <Button variant="secondary" size="lg" className="w-full">
          Request a new link
        </Button>
      </Link>
    </div>
  );
}
