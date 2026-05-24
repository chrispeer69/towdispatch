'use client';
import type {
  DotDriverDqViewDto,
  DotHosViolationReportRow,
  DotOpenDvirDto,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';

interface Props {
  hosViolations: DotHosViolationReportRow[];
  dqDeficiencies: DotDriverDqViewDto[];
  openDvirs: DotOpenDvirDto[];
}

const labelCls = 'block text-xs uppercase tracking-wide text-text-secondary-on-dark mb-1';

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReportsClient({ hosViolations, dqDeficiencies, openDvirs }: Props): JSX.Element {
  return (
    <section>
      <header className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DOT Reports</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            HOS violations (last 90 days), DQ deficiencies, and open DVIR defects.
          </p>
        </div>
        <Link href="/dot" className="text-accent-orange text-sm">
          ← DOT hub
        </Link>
      </header>

      {/* HOS violations */}
      <div className="mb-6">
        <h2 className="text-base font-semibold mb-3">
          HOS Violations — Last 90 Days
          {hosViolations.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-status-danger uppercase tracking-wide">
              {hosViolations.length} driver{hosViolations.length !== 1 ? 's' : ''}
            </span>
          )}
        </h2>
        <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left px-4 py-2.5">Driver</th>
                <th className="text-right px-4 py-2.5">Violations</th>
                <th className="text-left px-4 py-2.5">Most recent</th>
              </tr>
            </thead>
            <tbody>
              {hosViolations.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-text-secondary-on-dark">
                    No HOS violations in the last 90 days.
                  </td>
                </tr>
              )}
              {hosViolations.map((row) => (
                <tr
                  key={row.driverId}
                  className="border-t border-border-on-dark hover:bg-bg-base/30"
                >
                  <td className="px-4 py-2.5 font-semibold text-sm">{row.driverName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-status-danger/15 text-status-danger">
                      {row.violationCount}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {row.violations[0] ? (
                      <>
                        <span
                          className={`mr-1.5 inline-block px-1.5 py-px rounded text-[10px] font-semibold uppercase ${
                            row.violations[0].severity === 'violation'
                              ? 'bg-status-danger/15 text-status-danger'
                              : 'bg-status-warning/15 text-status-warning'
                          }`}
                        >
                          {row.violations[0].severity}
                        </span>
                        {row.violations[0].rule.replace(/_/g, ' ')} —{' '}
                        {fmtDatetime(row.violations[0].at)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DQ deficiencies */}
      <div className="mb-6">
        <h2 className="text-base font-semibold mb-3">
          DQ File Deficiencies
          {dqDeficiencies.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-status-danger uppercase tracking-wide">
              {dqDeficiencies.length} driver{dqDeficiencies.length !== 1 ? 's' : ''}
            </span>
          )}
        </h2>
        <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left px-4 py-2.5">Driver</th>
                <th className="text-left px-4 py-2.5">CDL</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Missing items</th>
                <th className="text-left px-4 py-2.5">Expiring</th>
              </tr>
            </thead>
            <tbody>
              {dqDeficiencies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-secondary-on-dark">
                    No DQ deficiencies — all driver files are current.
                  </td>
                </tr>
              )}
              {dqDeficiencies.map((d) => (
                <tr key={d.driverId} className="border-t border-border-on-dark hover:bg-bg-base/30">
                  <td className="px-4 py-2.5 font-semibold text-sm">
                    {d.firstName} {d.lastName}
                    {d.employeeNumber && (
                      <div className="text-[11px] font-normal text-text-secondary-on-dark">
                        {d.employeeNumber}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{d.cdlClass}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                        d.dqFileStatus === 'complete'
                          ? 'bg-status-success/15 text-status-success'
                          : d.dqFileStatus === 'on_hold'
                            ? 'bg-status-warning/15 text-status-warning'
                            : 'bg-status-danger/15 text-status-danger'
                      }`}
                    >
                      {d.dqFileStatus.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-status-danger">
                    {d.missing.length > 0
                      ? d.missing.map((m) => m.replace(/_/g, ' ')).join(', ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-status-warning">
                    {d.expiring.length > 0
                      ? d.expiring
                          .map((x) => `${x.item.replace(/_/g, ' ')} (${x.daysLeft}d)`)
                          .join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open DVIR defects */}
      <div className="mb-6">
        <h2 className="text-base font-semibold mb-3">
          Open DVIR Defects
          {openDvirs.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-status-warning uppercase tracking-wide">
              {openDvirs.length} DVIR{openDvirs.length !== 1 ? 's' : ''}
            </span>
          )}
        </h2>
        <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <tr>
                <th className="text-left px-4 py-2.5">Driver</th>
                <th className="text-left px-4 py-2.5">Truck</th>
                <th className="text-left px-4 py-2.5">Submitted</th>
                <th className="text-left px-4 py-2.5">Defects</th>
              </tr>
            </thead>
            <tbody>
              {openDvirs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-secondary-on-dark">
                    No open DVIR defects.
                  </td>
                </tr>
              )}
              {openDvirs.map((dvir) => (
                <tr
                  key={dvir.dvirId}
                  className="border-t border-border-on-dark hover:bg-bg-base/30 align-top"
                >
                  <td className="px-4 py-2.5 text-xs font-semibold">{dvir.driverName}</td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {dvir.truckUnit ?? dvir.truckId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary-on-dark">
                    {fmtDatetime(dvir.submittedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {dvir.defects.map((def, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable in-render list
                      <div key={i} className="mb-0.5">
                        <span className="font-medium">{def.component}</span>
                        <span
                          className={`ml-1.5 inline-block px-1.5 py-px rounded text-[10px] font-semibold uppercase ${
                            def.severity === 'major' || def.severity === 'critical'
                              ? 'bg-status-danger/15 text-status-danger'
                              : 'bg-status-warning/15 text-status-warning'
                          }`}
                        >
                          {def.severity}
                        </span>
                        {def.notes && (
                          <span className="text-text-secondary-on-dark ml-1">— {def.notes}</span>
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {openDvirs.length > 0 && (
          <p className="mt-2 text-xs text-text-secondary-on-dark">
            Resolve defects in{' '}
            <Link href="/fleet/dvirs" className="text-accent-orange">
              Fleet → DVIRs
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  );
}
