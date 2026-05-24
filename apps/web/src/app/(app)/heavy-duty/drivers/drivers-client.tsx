'use client';
import { clientListDriverCerts, clientRecordDriverCert } from '@/lib/api/heavy-duty-client';
import {
  type HdDriverCertType,
  type HdDriverCertificationDto,
  hdDriverCertTypeValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type FormEvent, type JSX, useEffect, useState } from 'react';
import { certTypeLabel } from '../hd-ui-helpers';

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

interface DriverOpt {
  id: string;
  name: string;
}

export function DriverCertsClient({ drivers }: { drivers: DriverOpt[] }): JSX.Element {
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? '');
  const [certs, setCerts] = useState<HdDriverCertificationDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [certType, setCertType] = useState<HdDriverCertType>('hd_operator');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [docKey, setDocKey] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!driverId) return;
    let active = true;
    setLoading(true);
    setError(null);
    clientListDriverCerts(driverId)
      .then((rows) => {
        if (active) setCerts(rows);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load certifications.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [driverId]);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!driverId) {
      setError('Select a driver first.');
      return;
    }
    setBusy(true);
    try {
      const saved = await clientRecordDriverCert(driverId, {
        certType,
        verified,
        ...(issuedAt ? { issuedAt } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(docKey.trim() ? { docKey: docKey.trim() } : {}),
      });
      // One live row per (driver, cert_type): replace any existing of this type.
      setCerts((prev) => [...prev.filter((c) => c.certType !== saved.certType), saved]);
      setDocKey('');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-4xl space-y-6">
      <header>
        <Link href="/heavy-duty" className="text-accent-orange text-sm">
          ← Back to heavy-duty
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Driver certifications</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1">
          HD operator / rotator / hazmat / CDL credentials. Eligibility requires the relevant
          non-expired cert; recording a renewal supersedes the prior one.
        </p>
      </header>

      {drivers.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">
          No drivers found. Add drivers under{' '}
          <Link href="/fleet" className="text-accent-orange">
            Trucks/Drivers
          </Link>{' '}
          first.
        </p>
      ) : (
        <>
          <label className="block max-w-sm">
            <span className={labelCls}>Driver</span>
            <select
              className={inputCls}
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger"
            >
              {error}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h2 className="font-semibold">On file</h2>
              {loading ? (
                <p className="text-sm text-text-secondary-on-dark">Loading…</p>
              ) : certs.length === 0 ? (
                <p className="text-sm text-text-secondary-on-dark">
                  No HD certifications recorded for this driver.
                </p>
              ) : (
                certs.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{certTypeLabel(c.certType)}</span>
                      {c.verifiedAt && (
                        <span className="text-xs text-status-success">verified</span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary-on-dark mt-1">
                      {c.issuedAt ? `issued ${c.issuedAt} · ` : ''}
                      {c.expiresAt ? `expires ${c.expiresAt}` : 'no expiry'}
                    </div>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 space-y-4"
            >
              <h2 className="font-semibold">Record / renew certification</h2>
              <label className="block">
                <span className={labelCls}>Type</span>
                <select
                  className={inputCls}
                  value={certType}
                  onChange={(e) => setCertType(e.target.value as HdDriverCertType)}
                >
                  {hdDriverCertTypeValues.map((t) => (
                    <option key={t} value={t}>
                      {certTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className={labelCls}>Issued</span>
                  <input
                    type="date"
                    className={inputCls}
                    value={issuedAt}
                    onChange={(e) => setIssuedAt(e.target.value)}
                  />
                </label>
                <label>
                  <span className={labelCls}>Expires</span>
                  <input
                    type="date"
                    className={inputCls}
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className={labelCls}>Document key (storage ref)</span>
                <input
                  className={inputCls}
                  value={docKey}
                  onChange={(e) => setDocKey(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                />
                Mark verified (stamps verifier + timestamp)
              </label>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save certification'}
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
