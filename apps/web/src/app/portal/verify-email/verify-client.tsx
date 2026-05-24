'use client';

import type { PortalMessages } from '@/lib/portal/i18n';
import Link from 'next/link';
import { type JSX, useEffect, useState } from 'react';
import { PortalCard, PortalNotice } from '../portal-ui';

type State = 'checking' | 'ok' | 'fail';

export function PortalVerifyClient({
  t,
  token,
}: { t: PortalMessages; token: string }): JSX.Element {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState('fail');
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/portal/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!cancelled) setState(res.ok ? 'ok' : 'fail');
      } catch {
        if (!cancelled) setState('fail');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <PortalCard title={t.signupTitle}>
      {state === 'checking' ? <PortalNotice>{t.verifyChecking}</PortalNotice> : null}
      {state === 'ok' ? <PortalNotice tone="success">{t.verifyOk}</PortalNotice> : null}
      {state === 'fail' ? <PortalNotice tone="error">{t.verifyFail}</PortalNotice> : null}
      {state !== 'checking' ? (
        <div className="mt-4 text-sm">
          <Link className="text-neutral-600 underline" href="/portal/login">
            {t.signIn}
          </Link>
        </div>
      ) : null}
    </PortalCard>
  );
}
