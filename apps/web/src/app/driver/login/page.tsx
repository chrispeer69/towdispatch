'use client';

/**
 * /driver/login — PIN-based driver sign-in.
 *
 * Three-step flow:
 *   1. Tenant slug entry (cached after first successful lookup)
 *   2. Driver picker (active drivers for that tenant, large tap targets)
 *   3. 4-digit PIN keypad (no real keyboard — large buttons)
 *
 * Calls /driver-auth/list-drivers then /driver-auth/login. Stores the
 * returned JWT + slim profile in localStorage. Locked accounts redirect
 * to /driver/locked. First-time set-pin flows are handled on
 * /driver/set-pin.
 */
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DriverApiError, driverApi } from '@/lib/driver/api-client';
import { persistDriverSession, readTenantSlugHint } from '@/lib/driver/auth';
import type { DriverLoginResponse, DriverPickerResponse } from '@/lib/driver/types';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Step = 'tenant' | 'picker' | 'pin';

export default function DriverLoginPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get('next') ?? '/driver/workspace';

  const [step, setStep] = useState<Step>('tenant');
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenant, setTenant] = useState<DriverPickerResponse['tenant'] | null>(null);
  const [drivers, setDrivers] = useState<DriverPickerResponse['drivers']>([]);
  const [selectedDriver, setSelectedDriver] = useState<
    DriverPickerResponse['drivers'][number] | null
  >(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill the tenant slug if the driver has signed in on this device
  // before.
  useEffect(() => {
    const hint = readTenantSlugHint();
    if (hint) setTenantSlug(hint);
  }, []);

  async function lookupTenant(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await driverApi<DriverPickerResponse>(
        'POST',
        '/driver-auth/list-drivers',
        { tenantSlug: tenantSlug.trim().toLowerCase() },
        { anonymous: true },
      );
      setTenant(res.tenant);
      setDrivers(res.drivers);
      setStep('picker');
    } catch (err) {
      if (err instanceof DriverApiError) {
        setError(
          err.status === 404
            ? "We couldn't find that workshop. Check the slug and try again."
            : err.message,
        );
      } else {
        setError('Network error — check your connection.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(): Promise<void> {
    if (!tenant || !selectedDriver) return;
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await driverApi<DriverLoginResponse>(
        'POST',
        '/driver-auth/login',
        {
          driverId: selectedDriver.id,
          pin,
          tenantSlug: tenant.slug,
        },
        { anonymous: true },
      );
      const expiresAt = Date.now() + (res.expiresIn ?? 12 * 3600) * 1000;
      persistDriverSession(res.accessToken, {
        driverId: res.driver.id,
        firstName: res.driver.firstName,
        lastName: res.driver.lastName,
        preferredName: res.driver.preferredName,
        employeeNumber: res.driver.employeeNumber,
        tenantId: res.tenant.id,
        tenantSlug: res.tenant.slug,
        tenantName: res.tenant.name,
        expiresAt,
      });
      router.replace(next);
    } catch (err) {
      if (err instanceof DriverApiError) {
        if (err.status === 423 || err.code === 'account_locked') {
          router.replace('/driver/locked');
          return;
        }
        if (err.code === 'pin_not_set') {
          router.replace(`/driver/set-pin?driverId=${selectedDriver.id}&tenant=${tenant.slug}`);
          return;
        }
        setError(err.message);
        setPin('');
      } else {
        setError('Network error — check your connection.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-primary-on-dark">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        <div className="mb-6 mt-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            US Tow DISPATCH
          </p>
          <h1 className="mt-1 text-2xl font-extrabold uppercase tracking-tight">Driver Sign-In</h1>
        </div>

        <Card className="flex-1">
          <CardContent className="space-y-4 p-5">
            {step === 'tenant' ? (
              <>
                <Label htmlFor="tenantSlug">Workshop slug</Label>
                <Input
                  id="tenantSlug"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="e.g. springfield-towing"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  className="h-14"
                />
                {error ? <p className="text-sm text-danger">{error}</p> : null}
                <Button
                  size="touch"
                  className="w-full"
                  disabled={busy || tenantSlug.trim().length === 0}
                  onClick={lookupTenant}
                >
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      Next <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </Button>
                <p className="text-xs text-text-secondary-on-dark">
                  Your dispatcher gave you this slug — it's the short name of your towing company.
                </p>
              </>
            ) : null}

            {step === 'picker' && tenant ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm">
                    <span className="text-text-secondary-on-dark">Workshop:</span>{' '}
                    <span className="font-semibold">{tenant.name}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep('tenant')}
                    className="text-xs text-brand-primary underline"
                  >
                    Change
                  </button>
                </div>
                <p className="text-sm text-text-secondary-on-dark">Tap your name to continue.</p>
                <ul className="-mx-1 max-h-[60vh] space-y-1 overflow-y-auto">
                  {drivers.length === 0 ? (
                    <li className="rounded-[10px] border border-divider p-4 text-sm">
                      No active drivers found for this workshop. Ask dispatch.
                    </li>
                  ) : null}
                  {drivers.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDriver(d);
                          setStep('pin');
                          setError(null);
                        }}
                        className="flex h-14 w-full items-center justify-between rounded-[10px] border border-divider px-4 text-left hover:border-brand-primary"
                      >
                        <span className="font-semibold">
                          {d.preferredName ?? d.firstName} {d.lastName}
                        </span>
                        {d.employeeNumber ? (
                          <span className="font-mono text-xs text-text-secondary-on-dark">
                            #{d.employeeNumber}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {step === 'pin' && selectedDriver ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm">
                    Hi,{' '}
                    <span className="font-semibold">
                      {selectedDriver.preferredName ?? selectedDriver.firstName}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('picker');
                      setPin('');
                      setError(null);
                    }}
                    className="flex items-center gap-1 text-xs text-brand-primary underline"
                  >
                    <ArrowLeft className="h-3 w-3" /> Not me
                  </button>
                </div>
                <PinPad value={pin} onChange={setPin} />
                {error ? <p className="text-sm text-danger">{error}</p> : null}
                <Button
                  size="touch"
                  className="w-full"
                  disabled={busy || pin.length !== 4}
                  onClick={submitPin}
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Sign in'}
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * PIN keypad — large tap targets, no native keyboard. Renders 1-9, 0,
 * and a backspace. Numbers display as filled dots once typed.
 */
function PinPad({
  value,
  onChange,
}: { value: string; onChange: (v: string) => void }): JSX.Element {
  function append(d: string): void {
    if (value.length >= 4) return;
    onChange(value + d);
  }
  function backspace(): void {
    onChange(value.slice(0, -1));
  }
  return (
    <div>
      <div className="flex justify-center gap-3 py-3">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border ${i < value.length ? 'border-brand-primary bg-brand-primary' : 'border-divider'}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button
            key={d}
            size="touch"
            variant="secondary"
            className="text-2xl font-bold"
            onClick={() => append(d)}
            type="button"
          >
            {d}
          </Button>
        ))}
        <span />
        <Button
          size="touch"
          variant="secondary"
          className="text-2xl font-bold"
          onClick={() => append('0')}
          type="button"
        >
          0
        </Button>
        <Button
          size="touch"
          variant="ghost"
          onClick={backspace}
          type="button"
          aria-label="Backspace"
        >
          ←
        </Button>
      </div>
    </div>
  );
}
