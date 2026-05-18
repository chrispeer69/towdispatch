'use client';

/**
 * /driver/locked — friendly landing page when the driver's PIN row is
 * locked (≥5 failed attempts inside 15 minutes; locked 30 minutes).
 *
 * The /driver-auth/login error payload usually includes a `lockedUntil`
 * field. We pass it through as a query param so this page can render a
 * live countdown.
 */
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Phone } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function DriverLockedPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const until = params?.get('until');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remainingMs = until ? Math.max(0, new Date(until).getTime() - now) : null;
  const remainingLabel = remainingMs == null ? null : formatRemaining(remainingMs);
  const unlocked = remainingMs === 0;

  return (
    <div className="min-h-screen bg-bg-base text-text-primary-on-dark">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        <div className="mb-6 mt-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-status-warning">
            Locked
          </p>
          <h1 className="mt-1 text-2xl font-extrabold uppercase tracking-tight">
            Too many wrong PINs
          </h1>
        </div>

        <Card className="flex-1">
          <CardContent className="space-y-4 p-5">
            <p className="text-sm">
              Your account is locked after several incorrect PIN attempts. This is a safety measure
              so a misplaced device can't be guessed into.
            </p>

            {remainingLabel ? (
              <div className="rounded-[10px] border border-status-warning/40 bg-status-warning/10 p-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                  Unlocks in
                </p>
                <p className="mt-1 font-mono text-3xl font-bold">{remainingLabel}</p>
              </div>
            ) : null}

            <a
              href="tel:+18005551234"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated text-base font-semibold"
            >
              <Phone className="h-5 w-5" />
              Call dispatch
            </a>

            <Button
              size="touch"
              variant={unlocked ? 'default' : 'secondary'}
              className="w-full"
              onClick={() => router.replace('/driver/login')}
            >
              {unlocked ? 'Try again' : 'Back to sign-in'}
            </Button>

            <p className="text-xs text-text-secondary-on-dark">
              An admin can clear the lock immediately from the office: Settings → Drivers → your row
              → "Clear PIN lockout".
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
