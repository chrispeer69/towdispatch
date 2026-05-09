'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function ResendVerification(): JSX.Element {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function resend(): Promise<void> {
    setStatus('sending');
    const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage(data?.message ?? 'Could not resend right now. Please try again later.');
      setStatus('error');
      return;
    }
    setStatus('sent');
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        onClick={resend}
        disabled={status === 'sending' || status === 'sent'}
        className="w-full"
      >
        {status === 'sending'
          ? 'Sending…'
          : status === 'sent'
            ? 'Sent! Check your inbox.'
            : 'Resend verification email'}
      </Button>
      {status === 'error' && message ? <p className="text-xs text-danger">{message}</p> : null}
    </div>
  );
}
