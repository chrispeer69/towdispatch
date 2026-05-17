/**
 * /dynamic-pricing/reports — three reports with date range + format export.
 *
 * Tier History, Tier Performance, Override Report. Excel and CSV downloads
 * stream through the BFF (/api/dynamic-pricing/reports/<id>?format=xlsx).
 */
import type { JSX } from 'react';
import { ReportsClient } from './reports-client';

export const metadata = { title: 'Dynamic Pricing Reports — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default function DynamicPricingReportsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Dynamic Pricing Reports
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Run, export, and print tier history, tier performance, and override reports.
        </p>
      </header>
      <ReportsClient />
    </div>
  );
}
