/**
 * /reports/builder — custom report template library (Session 53).
 *
 * Lists the caller's templates + those shared with the tenant, with their base
 * entity, projected fields, and schedule status. The visual drag-drop field
 * picker is a follow-up (documented in SESSION_53_REPORT.md); templates can be
 * created/run/scheduled today via the /reporting/builder API.
 *
 * TODO(i18n): English-only to match the Session 14 reporting surface.
 */
import { fetchBuilderTemplates } from '@/lib/api/reporting-builder';
import { requireUser } from '@/lib/auth/session';
import type { ReportTemplateDto } from '@ustowdispatch/shared';
import Link from 'next/link';

export const metadata = { title: 'Report Builder — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function ReportBuilderPage(): Promise<JSX.Element> {
  await requireUser();
  const { data: templates } = await fetchBuilderTemplates();

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            Report Builder
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Saved custom reports over jobs, invoices, accounts, impound, liens, drivers, and trucks.
          </p>
        </div>
        <Link
          href="/reports/kpi"
          className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-sm text-text-primary hover:bg-steel-light"
        >
          KPI dashboard
        </Link>
      </header>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-steel-border bg-steel-mid/20 p-8 text-center">
          <p className="text-sm text-text-secondary">
            No saved report templates yet. Create one via the builder API (
            <code className="font-mono text-xs">POST /api/reporting/builder/templates</code>) — pick
            a base entity, choose allowlisted fields, add filters, group, and sort.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="template-list">
          {templates.map((t) => (
            <TemplateRow key={t.id} template={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateRow({ template }: { template: ReportTemplateDto }): JSX.Element {
  return (
    <li className="rounded-lg border border-steel-border bg-steel-mid/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-condensed text-lg font-bold uppercase tracking-wide">
              {template.name}
            </h2>
            <span className="rounded bg-steel/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
              {template.baseEntity}
            </span>
            {template.isSharedWithTenant ? (
              <span className="rounded bg-steel/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                Shared
              </span>
            ) : null}
          </div>
          {template.description ? (
            <p className="mt-1 truncate text-xs text-text-secondary">{template.description}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-text-muted">
            {template.selectedFields.length} fields
            {template.groupBy.length > 0 ? ` · grouped by ${template.groupBy.join(', ')}` : ''}
            {template.filters.length > 0 ? ` · ${template.filters.length} filters` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {template.schedule ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ok">
              {template.schedule.cadence} · {template.schedule.format}
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
              No schedule
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
