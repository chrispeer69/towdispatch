'use client';
import { downloadAuditPacket } from '@/lib/api/dot-client';
import type { DotCarrierProfileDto } from '@ustowdispatch/shared';
import {
  AlertTriangle,
  ClipboardList,
  FileText,
  FlaskConical,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { type JSX, useState } from 'react';

interface Props {
  profile: DotCarrierProfileDto | null;
}

const inputCls =
  'w-full bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange';
const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

const NAV_CARDS = [
  {
    label: 'Driver Qualifications',
    desc: 'DQ file status, missing items, expiration tracking.',
    href: '/dot/drivers',
    icon: Users,
  },
  {
    label: 'Hours of Service',
    desc: 'Log HOS entries, review weekly totals and violations.',
    href: '/dot/hos',
    icon: ClipboardList,
  },
  {
    label: 'Drug & Alcohol',
    desc: 'Record and review drug/alcohol test results.',
    href: '/dot/drug-alcohol',
    icon: FlaskConical,
  },
  {
    label: 'Incidents',
    desc: 'Accident register per 49 CFR 390.15.',
    href: '/dot/incidents',
    icon: AlertTriangle,
  },
  {
    label: 'Reports',
    desc: 'HOS violations, DQ deficiencies, open DVIR defects.',
    href: '/dot/reports',
    icon: FileText,
  },
  {
    label: 'DVIR Entry',
    desc: 'Vehicle inspection reports live in Fleet.',
    href: '/fleet/dvirs',
    icon: Truck,
  },
];

export function DotHubClient({ profile }: Props): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload(): Promise<void> {
    setDownloadError(null);
    if (!from || !to) {
      setDownloadError('Both a start and end date are required.');
      return;
    }
    if (to < from) {
      setDownloadError('End date must be on or after start date.');
      return;
    }
    setDownloading(true);
    try {
      await downloadAuditPacket(from, to);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DOT Compliance</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            FMCSA recordkeeping: carrier profile, driver qualifications, HOS logs, drug &amp;
            alcohol program, and incident register.
          </p>
        </div>
        <Link
          href="/dot/carrier-profile"
          className="px-4 py-2 rounded-md bg-accent-orange text-white font-semibold whitespace-nowrap"
        >
          <ShieldCheck className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          Carrier profile
        </Link>
      </header>

      {/* Carrier summary or setup CTA */}
      <div className="mb-6 rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        {profile ? (
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className={labelCls}>Legal name</p>
              <p className="font-semibold">{profile.legalName}</p>
            </div>
            {profile.dbaName && (
              <div>
                <p className={labelCls}>DBA</p>
                <p>{profile.dbaName}</p>
              </div>
            )}
            {profile.usdotNumber && (
              <div>
                <p className={labelCls}>USDOT #</p>
                <p className="tabular-nums">{profile.usdotNumber}</p>
              </div>
            )}
            {profile.mcNumber && (
              <div>
                <p className={labelCls}>MC #</p>
                <p className="tabular-nums">{profile.mcNumber}</p>
              </div>
            )}
            <div>
              <p className={labelCls}>Carrier type</p>
              <p className="capitalize">{profile.carrierType.replace(/_/g, ' ')}</p>
            </div>
            {profile.safetyRating && (
              <div>
                <p className={labelCls}>Safety rating</p>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                    profile.safetyRating === 'satisfactory'
                      ? 'bg-status-success/15 text-status-success'
                      : profile.safetyRating === 'conditional'
                        ? 'bg-status-warning/15 text-status-warning'
                        : 'bg-status-danger/15 text-status-danger'
                  }`}
                >
                  {profile.safetyRating}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <ShieldCheck className="h-8 w-8 text-text-secondary-on-dark shrink-0" />
            <div>
              <p className="font-semibold">No carrier profile set up yet</p>
              <p className="text-text-secondary-on-dark text-sm mt-0.5">
                Add your USDOT number, legal name, and carrier type to enable full compliance
                reporting.
              </p>
            </div>
            <Link
              href="/dot/carrier-profile"
              className="ml-auto px-4 py-2 rounded-md bg-accent-orange text-white font-semibold text-sm whitespace-nowrap"
            >
              Set up profile →
            </Link>
          </div>
        )}
      </div>

      {/* Nav card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {NAV_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 hover:border-accent-orange transition-colors"
          >
            <card.icon className="h-6 w-6 text-accent-orange mb-3" />
            <p className="font-semibold group-hover:text-accent-orange transition-colors">
              {card.label}
            </p>
            <p className="text-text-secondary-on-dark text-sm mt-1">{card.desc}</p>
          </Link>
        ))}
      </div>

      {/* Audit packet generator */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="text-lg font-semibold mb-1">Audit Packet</h2>
        <p className="text-text-secondary-on-dark text-sm mb-4">
          Generate a PDF bundle covering the selected date range — carrier profile, DQ roster, HOS
          logs, drug tests, incidents, and open DVIRs.
        </p>
        {downloadError && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger"
          >
            {downloadError}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[140px]">
            <span className={labelCls}>From date</span>
            <input
              type="date"
              className={inputCls}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex-1 min-w-[140px]">
            <span className={labelCls}>To date</span>
            <input
              type="date"
              className={inputCls}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="px-5 py-2 rounded-md bg-accent-orange text-white font-semibold text-sm disabled:opacity-60"
          >
            {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </section>
  );
}
