'use client';

/**
 * /driver/set-pin — first-time PIN setup for a driver whose PIN hasn't
 * been initialized yet. Called when /driver-auth/login returns
 * pin_not_set. We don't have a dedicated driver-JWT-friendly set-pin
 * endpoint (the admin-side /driver-auth/set-pin requires an operator
 * JWT), so this page collects the new PIN twice and instructs the
 * driver to ask dispatch to enroll it. Once dispatch has set the PIN
 * the driver returns and completes the normal login flow.
 *
 * If a future API exposes a self-enroll endpoint, this page swaps
 * the instruction block for a direct POST.
 */
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function DriverSetPinPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const driverId = params?.get('driverId') ?? '';
  const tenantSlug = params?.get('tenant') ?? '';

  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  function validate(): boolean {
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      return false;
    }
    if (pin !== confirm) {
      setError('PINs do not match');
      return false;
    }
    setError(null);
    return true;
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-primary-on-dark">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        <div className="mb-6 mt-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            First-time setup
          </p>
          <h1 className="mt-1 text-2xl font-extrabold uppercase tracking-tight">Choose your PIN</h1>
        </div>

        <Card className="flex-1">
          <CardContent className="space-y-4 p-5">
            <div>
              <label className="text-sm font-semibold" htmlFor="pin1">
                Pick a 4-digit PIN
              </label>
              <input
                id="pin1"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                pattern="\d{4}"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="mt-1 block h-14 w-full rounded-[10px] border border-divider bg-bg-surface px-4 text-center text-2xl tracking-[1em] text-text-primary-on-dark"
              />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="pin2">
                Confirm PIN
              </label>
              <input
                id="pin2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                pattern="\d{4}"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
                className="mt-1 block h-14 w-full rounded-[10px] border border-divider bg-bg-surface px-4 text-center text-2xl tracking-[1em] text-text-primary-on-dark"
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <div className="rounded-[10px] border border-info/30 bg-info/10 p-3 text-sm">
              <p className="font-semibold">Confirm with dispatch.</p>
              <p className="mt-1 text-text-secondary-on-dark">
                Your dispatcher needs to enroll this PIN on the office side before it works. Tell
                them the digits in person, or call the shop. Once they've set it, come back here and
                sign in.
              </p>
              {driverId ? (
                <p className="mt-2 text-xs">
                  Driver id: <span className="font-mono">{driverId.slice(0, 8)}…</span>
                  {tenantSlug ? (
                    <>
                      {' '}
                      - Workshop: <span className="font-mono">{tenantSlug}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <Button
              size="touch"
              className="w-full"
              onClick={() => {
                if (validate()) {
                  router.replace('/driver/login');
                }
              }}
            >
              I've told dispatch — back to sign-in
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
