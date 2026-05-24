'use client';
import type {
  HdCertExpiryReportDto,
  HdEquipmentUtilizationReportDto,
  HdJobsByMonthReportDto,
  HdRateSheetDto,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type JSX, useState } from 'react';
import { certStatusBadgeClass, certTypeLabel, formatCents } from './hd-ui-helpers';

interface Props {
  jobsByMonth: HdJobsByMonthReportDto;
  certExpiry: HdCertExpiryReportDto;
  utilization: HdEquipmentUtilizationReportDto;
  rateSheets: HdRateSheetDto[];
  capabilitiesCount: number;
}

const card = 'rounded-md border border-border-on-dark bg-bg-surface-elevated p-5';
const statNum = 'text-3xl font-bold tracking-tight';
const statLbl = 'text-xs uppercase tracking-wide text-text-secondary-on-dark';

export function HeavyDutyOverviewClient({
  jobsByMonth,
  certExpiry,
  utilization,
  rateSheets,
  capabilitiesCount,
}: Props): JSX.Element {
  const router = useRouter();
  const [jobId, setJobId] = useState('');

  function lookupJob(e: FormEvent): void {
    e.preventDefault();
    const id = jobId.trim();
    if (id) router.push(`/heavy-duty/jobs/${id}`);
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Heavy-Duty Specialist</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            Class 7/8 &amp; commercial recovery — capabilities, certifications, rate sheets, and
            HD-aware dispatch.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/heavy-duty/trucks"
            className="px-3 py-2 rounded-md border border-border-on-dark"
          >
            Truck capabilities
          </Link>
          <Link
            href="/heavy-duty/drivers"
            className="px-3 py-2 rounded-md border border-border-on-dark"
          >
            Driver certifications
          </Link>
          <Link
            href="/heavy-duty/rate-sheets"
            className="px-3 py-2 rounded-md border border-border-on-dark"
          >
            Rate sheets
          </Link>
        </nav>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={card}>
          <div className={statLbl}>HD jobs (all time)</div>
          <div className={statNum}>{jobsByMonth.totalJobs}</div>
        </div>
        <div className={card}>
          <div className={statLbl}>HD revenue</div>
          <div className={statNum}>{formatCents(jobsByMonth.totalRevenueCents)}</div>
        </div>
        <div className={card}>
          <div className={statLbl}>Rotator utilization</div>
          <div className={statNum}>{utilization.rotatorUtilizationPct}%</div>
          <div className="text-xs text-text-secondary-on-dark mt-1">
            {utilization.rotatorJobs}/{utilization.totalHdJobs} jobs
          </div>
        </div>
        <div className={card}>
          <div className={statLbl}>HD-equipped trucks</div>
          <div className={statNum}>{capabilitiesCount}</div>
        </div>
      </div>

      {/* Job lookup */}
      <form onSubmit={lookupJob} className={card}>
        <label htmlFor="hd-job-lookup" className={statLbl}>
          Open an HD job ticket
        </label>
        <div className="flex gap-2 mt-2">
          <input
            id="hd-job-lookup"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="Paste a job ID to mark heavy-duty / view eligibility"
            className="flex-1 bg-bg-base border border-border-on-dark rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-orange"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-md bg-accent-orange text-white text-sm font-semibold"
          >
            Open
          </button>
        </div>
      </form>

      <div className="grid md:grid-cols-2 gap-6">
        {/* HD jobs by month */}
        <div className={card}>
          <h2 className="font-semibold mb-3">HD jobs by month</h2>
          {jobsByMonth.rows.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark">No HD jobs recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary-on-dark">
                  <th className="py-1 font-medium">Month</th>
                  <th className="py-1 font-medium text-right">Jobs</th>
                  <th className="py-1 font-medium text-right">Revenue</th>
                  <th className="py-1 font-medium text-right">Avg ticket</th>
                </tr>
              </thead>
              <tbody>
                {jobsByMonth.rows.map((r) => (
                  <tr key={r.month} className="border-t border-border-on-dark">
                    <td className="py-1.5">{r.month}</td>
                    <td className="py-1.5 text-right">{r.jobCount}</td>
                    <td className="py-1.5 text-right">{formatCents(r.revenueCents)}</td>
                    <td className="py-1.5 text-right">{formatCents(r.avgTicketCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Cert expiry roster */}
        <div className={card}>
          <h2 className="font-semibold mb-3">
            Cert-expiry roster{' '}
            <span className="text-xs font-normal text-text-secondary-on-dark">
              (next {certExpiry.windowDays} days)
            </span>
          </h2>
          {certExpiry.rows.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark">No certifications expiring soon.</p>
          ) : (
            <ul className="space-y-2">
              {certExpiry.rows.map((r) => (
                <li
                  key={`${r.driverId}-${r.certType}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    {r.driverName} — {certTypeLabel(r.certType)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${certStatusBadgeClass(r.status)}`}
                  >
                    {r.status === 'expired'
                      ? 'expired'
                      : `${r.daysUntilExpiry}d (${r.expiresAt ?? '—'})`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Rate sheets snapshot */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Rate sheets</h2>
          <Link href="/heavy-duty/rate-sheets" className="text-accent-orange text-sm">
            Manage →
          </Link>
        </div>
        {rateSheets.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">
            No HD rate sheets yet. Create one to price on-scene estimates.
          </p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {rateSheets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-md border border-border-on-dark px-3 py-2 text-sm"
              >
                <span>{s.name}</span>
                <span className="text-text-secondary-on-dark">
                  {formatCents(s.hourlyRateCents)}/hr
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
