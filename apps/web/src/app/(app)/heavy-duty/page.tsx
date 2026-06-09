/**
 * /heavy-duty — Heavy-Duty Specialist overview.
 *
 * Server-fetches the three HD reports + the rate sheets + the truck
 * capability roster and hands them to the client dashboard. AUDITOR is
 * read-only; MANAGER / ACCOUNTING / DRIVER get a 403 explainer.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type {
  HdCertExpiryReportDto,
  HdEquipmentUtilizationReportDto,
  HdJobsByMonthReportDto,
  HdRateSheetDto,
  HdTruckCapabilityDto,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { HeavyDutyOverviewClient } from './overview-client';

export const metadata = { title: 'Heavy-Duty — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function HeavyDutyOverviewPage(): Promise<JSX.Element> {
  const token = await getSessionToken();

  const jobsByMonth = await tryFetch(() =>
    apiServer<HdJobsByMonthReportDto>('/heavy-duty/reports/jobs-by-month', {
      accessToken: token ?? null,
    }),
  );

  if (jobsByMonth.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="text-2xl font-bold mb-2">Heavy-Duty Specialist</h1>
        <p className="text-text-secondary-on-dark">
          Your role does not have access to the heavy-duty module. Ask an owner or admin to extend
          your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  const [certExpiry, utilization, rateSheets, capabilities] = await Promise.all([
    tryFetch(() =>
      apiServer<HdCertExpiryReportDto>('/heavy-duty/reports/cert-expiry?windowDays=60', {
        accessToken: token ?? null,
      }),
    ),
    tryFetch(() =>
      apiServer<HdEquipmentUtilizationReportDto>('/heavy-duty/reports/equipment-utilization', {
        accessToken: token ?? null,
      }),
    ),
    tryFetch(() =>
      apiServer<HdRateSheetDto[]>('/heavy-duty/rate-sheets', { accessToken: token ?? null }),
    ),
    tryFetch(() =>
      apiServer<HdTruckCapabilityDto[]>('/heavy-duty/trucks/capabilities', {
        accessToken: token ?? null,
      }),
    ),
  ]);

  return (
    <HeavyDutyOverviewClient
      jobsByMonth={jobsByMonth.data ?? { rows: [], totalJobs: 0, totalRevenueCents: 0 }}
      certExpiry={
        certExpiry.data ?? { windowDays: 60, rows: [], expiringCount: 0, expiredCount: 0 }
      }
      utilization={utilization.data ?? { totalHdJobs: 0, rotatorJobs: 0, rotatorUtilizationPct: 0 }}
      rateSheets={rateSheets.data ?? []}
      capabilitiesCount={(capabilities.data ?? []).length}
    />
  );
}
