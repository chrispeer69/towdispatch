'use client';
import { upsertCarrierProfile } from '@/lib/api/dot-client';
import {
  type DotCarrierProfileDto,
  dotCarrierTypeValues,
  dotSafetyRatingValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';

interface Props {
  profile: DotCarrierProfileDto | null;
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const CARRIER_TYPE_LABELS: Record<(typeof dotCarrierTypeValues)[number], string> = {
  authorized_for_hire: 'Authorized for hire',
  private: 'Private',
  exempt: 'Exempt',
};

const SAFETY_RATING_LABELS: Record<(typeof dotSafetyRatingValues)[number], string> = {
  satisfactory: 'Satisfactory',
  conditional: 'Conditional',
  unsatisfactory: 'Unsatisfactory',
  unrated: 'Unrated',
};

export function CarrierProfileClient({ profile }: Props): JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [legalName, setLegalName] = useState(profile?.legalName ?? '');
  const [dbaName, setDbaName] = useState(profile?.dbaName ?? '');
  const [usdotNumber, setUsdotNumber] = useState(profile?.usdotNumber ?? '');
  const [mcNumber, setMcNumber] = useState(profile?.mcNumber ?? '');
  const [carrierType, setCarrierType] = useState<(typeof dotCarrierTypeValues)[number]>(
    profile?.carrierType ?? 'authorized_for_hire',
  );
  const [safetyRating, setSafetyRating] = useState<(typeof dotSafetyRatingValues)[number] | ''>(
    profile?.safetyRating ?? '',
  );
  const [operatingClassification, setOperatingClassification] = useState(
    profile?.operatingClassification.join(', ') ?? '',
  );
  const [lastAuditedAt, setLastAuditedAt] = useState(
    profile?.lastAuditedAt ? profile.lastAuditedAt.slice(0, 10) : '',
  );

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!legalName.trim()) {
      setError('Legal name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const opClass = operatingClassification
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await upsertCarrierProfile({
        legalName: legalName.trim(),
        carrierType,
        operatingClassification: opClass,
        ...(dbaName.trim() ? { dbaName: dbaName.trim() } : {}),
        ...(usdotNumber.trim() ? { usdotNumber: usdotNumber.trim() } : {}),
        ...(mcNumber.trim() ? { mcNumber: mcNumber.trim() } : {}),
        ...(safetyRating ? { safetyRating } : {}),
        ...(lastAuditedAt ? { lastAuditedAt: new Date(lastAuditedAt).toISOString() } : {}),
      });
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Save failed.');
      setSubmitting(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <header className="mb-6">
        <Link href="/dot" className="text-accent-orange text-sm">
          ← Back to DOT Compliance
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Carrier Profile</h1>
        <p className="text-text-secondary-on-dark text-sm mt-1">
          Your FMCSA identity — USDOT number, legal name, carrier type, and safety rating.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <fieldset className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
          <legend className="px-1 text-sm font-semibold">Identity</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="md:col-span-2">
              <span className={labelCls}>Legal name *</span>
              <input
                className={inputCls}
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                required
                placeholder="ABC Towing LLC"
              />
            </label>
            <label>
              <span className={labelCls}>DBA name</span>
              <input
                className={inputCls}
                value={dbaName}
                onChange={(e) => setDbaName(e.target.value)}
                placeholder="Optional trade name"
              />
            </label>
            <label>
              <span className={labelCls}>USDOT number</span>
              <input
                className={inputCls}
                value={usdotNumber}
                onChange={(e) => setUsdotNumber(e.target.value)}
                placeholder="1234567"
              />
            </label>
            <label>
              <span className={labelCls}>MC number</span>
              <input
                className={inputCls}
                value={mcNumber}
                onChange={(e) => setMcNumber(e.target.value)}
                placeholder="MC-123456"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="bg-bg-surface-elevated rounded-md border border-border-on-dark p-5">
          <legend className="px-1 text-sm font-semibold">Classification &amp; rating</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label>
              <span className={labelCls}>Carrier type</span>
              <select
                className={inputCls}
                value={carrierType}
                onChange={(e) =>
                  setCarrierType(e.target.value as (typeof dotCarrierTypeValues)[number])
                }
              >
                {dotCarrierTypeValues.map((v) => (
                  <option key={v} value={v}>
                    {CARRIER_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Safety rating</span>
              <select
                className={inputCls}
                value={safetyRating}
                onChange={(e) =>
                  setSafetyRating(e.target.value as (typeof dotSafetyRatingValues)[number] | '')
                }
              >
                <option value="">— Not set —</option>
                {dotSafetyRatingValues.map((v) => (
                  <option key={v} value={v}>
                    {SAFETY_RATING_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Last audited</span>
              <input
                type="date"
                className={inputCls}
                value={lastAuditedAt}
                onChange={(e) => setLastAuditedAt(e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>Operating classification (comma-separated)</span>
              <input
                className={inputCls}
                value={operatingClassification}
                onChange={(e) => setOperatingClassification(e.target.value)}
                placeholder="e.g. Interstate, Hazmat"
              />
            </label>
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 rounded-md bg-accent-orange text-white font-semibold disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save carrier profile'}
          </button>
          <Link href="/dot" className="text-text-secondary-on-dark text-sm">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
