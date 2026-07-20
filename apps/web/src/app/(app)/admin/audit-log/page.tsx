/**
 * /admin/audit-log — SOC 2 audit-log viewer (Session 31).
 *
 * Read-only window onto the tenant's append-only audit trail. Restricted to
 * OWNER / ADMIN (account operators) and AUDITOR (the read-only role we hand to
 * an external SOC 2 auditor). Roles outside that set are bounced to /forbidden.
 *
 * Filtering uses a native GET <form> — no client JS, keyboard- and
 * screen-reader-accessible by construction, and every filtered view is a
 * shareable URL (good for evidence: "here is the exact query I ran"). Date
 * inputs are normalized to day-boundary UTC ISO so they satisfy the API's
 * offset-aware datetime contract.
 *
 * before_state / after_state arrive already redacted from the API (secrets
 * stripped server-side); we render them as pretty JSON inside a <details>.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchAuditLog } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/cookies';
import { requireUser } from '@/lib/auth/session';
import { ROLES, type Role, auditActionValues } from '@ustowdispatch/shared';
import { AlertTriangle } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

export const metadata = { title: 'Audit Log — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const VIEW_ROLES: readonly Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.AUDITOR];
const PER_PAGE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const me = await requireUser();
  const role = me.user.role as Role;
  if (!VIEW_ROLES.includes(role)) {
    redirect('/forbidden');
  }

  const sp = await searchParams;
  const resourceType = one(sp.resourceType);
  const actorId = one(sp.actorId);
  const action = one(sp.action);
  const fromDate = one(sp.from); // YYYY-MM-DD from <input type="date">
  const toDate = one(sp.to);
  const page = Math.max(1, Number.parseInt(one(sp.page) || '1', 10) || 1);

  // Normalize day-boundary dates to offset-aware ISO for the API contract.
  const query: Record<string, string | undefined> = {
    resourceType: resourceType || undefined,
    actorId: actorId || undefined,
    action: action || undefined,
    from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
    to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
    page: String(page),
    perPage: String(PER_PAGE),
  };

  const token = await getSessionToken();
  const result = await tryFetch(() => fetchAuditLog(query, token));

  const totalPages = result.data ? Math.max(1, Math.ceil(result.data.total / PER_PAGE)) : 1;
  const pageHref = (target: number): string => {
    const params = new URLSearchParams();
    if (resourceType) params.set('resourceType', resourceType);
    if (actorId) params.set('actorId', actorId);
    if (action) params.set('action', action);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    params.set('page', String(target));
    return `/admin/audit-log?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Audit Log
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">
          Append-only record of every state-changing action in your account. Scoped to your
          organization. Secrets are redacted. Retained for 7 years.
        </p>
      </header>

      <form
        method="get"
        className="grid grid-cols-1 gap-3 rounded-[14px] border border-white/10 bg-white/5 p-4 sm:grid-cols-2 lg:grid-cols-6"
        aria-label="Filter audit log"
      >
        <label className="flex flex-col gap-1 text-xs text-text-secondary-on-dark lg:col-span-2">
          Resource (table)
          <input
            type="text"
            name="resourceType"
            defaultValue={resourceType}
            placeholder="e.g. invoices"
            pattern="[a-z_][a-z0-9_]*"
            className="rounded-md border border-white/15 bg-surface-base px-2 py-1.5 text-sm text-text-primary-on-dark"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary-on-dark lg:col-span-2">
          Actor (user ID)
          <input
            type="text"
            name="actorId"
            defaultValue={actorId}
            placeholder="UUID"
            className="rounded-md border border-white/15 bg-surface-base px-2 py-1.5 text-sm text-text-primary-on-dark"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary-on-dark">
          Action
          <select
            name="action"
            defaultValue={action}
            className="rounded-md border border-white/15 bg-surface-base px-2 py-1.5 text-sm text-text-primary-on-dark"
          >
            <option value="">All</option>
            {auditActionValues.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary-on-dark">
          From
          <input
            type="date"
            name="from"
            defaultValue={fromDate}
            className="rounded-md border border-white/15 bg-surface-base px-2 py-1.5 text-sm text-text-primary-on-dark"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary-on-dark">
          To
          <input
            type="date"
            name="to"
            defaultValue={toDate}
            className="rounded-md border border-white/15 bg-surface-base px-2 py-1.5 text-sm text-text-primary-on-dark"
          />
        </label>
        <div className="flex items-end gap-2 lg:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-brand-orange-dark px-4 py-1.5 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
          <a
            href="/admin/audit-log"
            className="rounded-md border border-white/15 px-4 py-1.5 text-sm text-text-secondary-on-dark"
          >
            Reset
          </a>
        </div>
      </form>

      {result.error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <div>
            <p className="font-semibold text-text-primary-on-dark">
              Couldn&rsquo;t load audit log (HTTP {result.error.status})
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{result.error.message}</p>
          </div>
        </div>
      ) : result.data.data.length === 0 ? (
        <p className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-text-secondary-on-dark">
          No audit entries match these filters.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[14px] border border-white/10">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Audit log entries</caption>
              <thead className="bg-white/5 text-xs uppercase text-text-secondary-on-dark">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Time (UTC)
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Action
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Resource
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Resource ID
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Actor
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((entry) => (
                  <tr key={entry.id} className="border-t border-white/5 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-text-secondary-on-dark">
                      {entry.createdAt}
                    </td>
                    <td className="px-3 py-2 font-semibold text-text-primary-on-dark">
                      {entry.action}
                    </td>
                    <td className="px-3 py-2 text-text-primary-on-dark">{entry.resourceType}</td>
                    <td className="px-3 py-2 font-mono text-xs text-text-secondary-on-dark">
                      {entry.resourceId ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-secondary-on-dark">
                      {entry.actorId ?? 'system'}
                    </td>
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer text-xs text-brand-orange-dark">
                          View change
                        </summary>
                        <pre className="mt-2 max-w-md overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-text-secondary-on-dark">
                          {JSON.stringify(
                            { before: entry.beforeState, after: entry.afterState },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav
            className="flex items-center justify-between text-sm text-text-secondary-on-dark"
            aria-label="Audit log pagination"
          >
            <span>
              {result.data.total} {result.data.total === 1 ? 'entry' : 'entries'} - page {page} of{' '}
              {totalPages}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <a
                  href={pageHref(page - 1)}
                  rel="prev"
                  className="rounded-md border border-white/15 px-3 py-1.5"
                >
                  Previous
                </a>
              ) : null}
              {page < totalPages ? (
                <a
                  href={pageHref(page + 1)}
                  rel="next"
                  className="rounded-md border border-white/15 px-3 py-1.5"
                >
                  Next
                </a>
              ) : null}
            </span>
          </nav>
        </>
      )}
    </div>
  );
}
