'use client';
/**
 * /driver/login — PIN-based driver sign-in.
 *
 * Frictionless three-step flow:
 *   1. 6-digit Company Code (cached after first successful lookup —
 *      returning drivers skip this step).
 *   2. Driver picker (active drivers for that tenant, large tap targets).
 *   3. 4-digit PIN keypad (no real keyboard — large buttons).
 *
 * Calls /driver-auth/lookup-by-code then /driver-auth/login. Stores the
 * returned JWT + slim profile in localStorage. Locked accounts redirect
 * to /driver/locked. First-time set-pin flows are handled on
 * /driver/set-pin. The /driver/d/[code] vanity URL pre-binds the code
 * and lands here at the picker step automatically.
 *
 * The dispatcher's URL slug is intentionally NOT exposed on this surface
 * — drivers don't know slugs. The 6-digit code is the only identifier
 * the dispatcher needs to share. Each tenant gets a unique code via the
 * fn_tenants_assign_company_code trigger from migration 0034.
 */
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DriverApiError, driverApi } from '@/lib/driver/api-client';
import {
  clearTenantCode,
  persistDriverSession,
  persistTenantCode,
  readTenantCodeHint,
  useDriverAuth,
} from '@/lib/driver/auth';
import type { DriverLoginResponse, DriverPickerResponse } from '@/lib/driver/types';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Step = 'code' | 'picker' | 'pin';

export default function DriverLoginPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get('next') ?? '/driver/workspace';
  // The /driver/d/[code] vanity-URL page redirects here with ?code=NNNNNN
  // and ?step=picker after a successful lookup; honor both.
  const initialStep = (searchParams?.get('step') as Step | null) ?? 'code';
  const codeFromUrl = searchParams?.get('code') ?? null;

  // If the device already holds a valid driver JWT, short-circuit the
  // entire sign-in flow and forward straight to the requested target.
  // Without this, the page would still render the cached-code picker
  // for a frame before <DriverAuthGate> picks up that the driver is
  // already signed in — producing a visible bounce that the founder
  // reported as 'PIN login loops back to the driver list'.
  const { jwt, profile } = useDriverAuth();
  const alreadySignedIn = Boolean(jwt && profile && profile.expiresAt > Date.now());
  useEffect(() => {
    if (alreadySignedIn) {
      router.replace(next);
    }
  }, [alreadySignedIn, next, router]);

  const [step, setStep] = useState<Step>(initialStep);
  const [code, setCode] = useState<string>(codeFromUrl ?? '');
  const [tenant, setTenant] = useState<DriverPickerResponse['tenant'] | null>(null);
  const [drivers, setDrivers] = useState<DriverPickerResponse['drivers']>([]);
  const [selectedDriver, setSelectedDriver] = useState<
    DriverPickerResponse['drivers'][number] | null
  >(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // First mount: if the device has remembered a 6-digit company code
  // from a prior login, auto-advance to the driver picker without
  // re-prompting. The code is a device-binding step — it identifies
  // which workshop's drivers to load — and forcing drivers to retype
  // it every shift is the friction the founder called out.
  //
  // If the cached code is rejected by the API (e.g. tenant got
  // renamed / the device is being repurposed for a different shop),
  // lookupCode falls back to showing the code-entry screen with the
  // remembered value still pre-filled and an explanatory error.
  //
  // The picker screen exposes a “Change workshop” button so a driver
  // moving between shops can clear the binding and re-enter the code.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupCode
  // is intentionally read fresh on each invocation; including it would
  // re-run this effect every render and break the one-shot bootstrap.
  useEffect(() => {
    if (codeFromUrl) {
      void lookupCode(codeFromUrl);
      return;
    }
    const hint = readTenantCodeHint();
    if (hint) {
      setCode(hint);
      void lookupCode(hint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookupCode(submittedCode: string): Promise<void> {
    if (!/^\d{6}$/.test(submittedCode)) {
      setError('Company code must be 6 digits');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await driverApi<DriverPickerResponse>(
        'POST',
        '/driver-auth/lookup-by-code',
        { companyCode: submittedCode },
        { anonymous: true },
      );
      setTenant(res.tenant);
      setDrivers(res.drivers);
      persistTenantCode(submittedCode);
      setStep('picker');
    } catch (err) {
      if (err instanceof DriverApiError) {
        setError(
          err.status === 404
            ? "We couldn't find a company with that code. Check with dispatch."
            : err.message,
        );
      } else {
        setError('Network error — check your connection.');
      }
      setCode('');
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
      // Daily-briefing gate. Before routing to the requested `next`
      // destination (workspace by default), check whether there is an
      // active briefing the driver has not yet acknowledged today. If
      // so, route to /driver/briefing first; the briefing page sends
      // the driver to `next` after acknowledgment.
      try {
        const briefingCheck = await driverApi<{ needs: boolean }>(
          'GET',
          '/driver-briefings/needs-acknowledgment',
        );
        if (briefingCheck.needs) {
          router.replace(`/driver/briefing?next=${encodeURIComponent(next)}`);
          return;
        }
      } catch {
        // If the briefing check fails (network, 404 = no briefing
        // configured, etc.), don't block the driver from working.
        // A failed-open briefing is the safer default than locking
        // out a driver because the briefing endpoint hiccupped.
      }
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

  if (alreadySignedIn) {
    // Render a neutral redirecting screen while router.replace(next) is
    // in flight. Prevents the cached-code picker from flashing for a
    // tick when a returning driver visits /driver/login while already
    // signed in.
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-secondary-on-dark">
        <p className="text-sm">Signing you in…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-primary-on-dark">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        <div className="mb-6 mt-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            US Tow Dispatch
          </p>
          <h1 className="mt-1 text-2xl font-extrabold uppercase tracking-tight">Driver Sign-In</h1>
        </div>

        <Card className="flex-1">
          <CardContent className="space-y-4 p-5">
            {step === 'code' ? (
              <>
                <p className="text-sm font-semibold">Enter your company code</p>
                <p className="text-xs text-text-secondary-on-dark">
                  Your dispatcher gave you a 6-digit code. You only need to enter it once on this
                  device.
                </p>
                <CodePad value={code} onChange={setCode} onComplete={lookupCode} />
                {error ? <p className="text-sm text-danger">{error}</p> : null}
                <Button
                  size="touch"
                  className="w-full"
                  disabled={busy || code.length !== 6}
                  onClick={() => lookupCode(code)}
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Continue'}
                </Button>
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
                    onClick={() => {
                      clearTenantCode();
                      setStep('code');
                      setCode('');
                      setTenant(null);
                      setDrivers([]);
                      setError(null);
                    }}
                    className="text-xs text-brand-primary underline"
                  >
                    Change workshop
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
                <PinPad value={pin} onChange={setPin} length={4} />
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
 * 6-digit Company Code pad. Auto-submits when 6 digits are entered. The
 * digits are visible (not dotted) — the code is not a secret, the
 * dispatcher has shared it openly with the driver.
 */
function CodePad({
  value,
  onChange,
  onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
}): JSX.Element {
  function append(d: string): void {
    if (value.length >= 6) return;
    const nextVal = value + d;
    onChange(nextVal);
    if (nextVal.length === 6) {
      // Defer to the next tick so the visible digit lands before the
      // network request fires.
      setTimeout(() => onComplete(nextVal), 0);
    }
  }
  function backspace(): void {
    onChange(value.slice(0, -1));
  }
  return (
    <div>
      <div className="flex justify-center gap-1.5 py-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`flex h-12 w-9 items-center justify-center rounded-[8px] border font-mono text-xl font-bold ${i < value.length ? 'border-brand-primary bg-brand-primary/10' : 'border-divider'}`}
          >
            {value[i] ?? ''}
          </span>
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

/**
 * 4-digit PIN keypad — large tap targets, no native keyboard. Renders 1-9,
 * 0, and a backspace. Numbers display as filled dots once typed (the PIN
 * IS a secret).
 */
function PinPad({
  value,
  onChange,
  length,
}: { value: string; onChange: (v: string) => void; length: number }): JSX.Element {
  function append(d: string): void {
    if (value.length >= length) return;
    onChange(value + d);
  }
  function backspace(): void {
    onChange(value.slice(0, -1));
  }
  return (
    <div>
      <div className="flex justify-center gap-3 py-3">
        {Array.from({ length }, (_, i) => i).map((i) => (
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
