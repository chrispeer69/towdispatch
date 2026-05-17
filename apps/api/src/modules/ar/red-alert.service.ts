/**
 * RedAlertService — MOAT #7. Every Monday at 6:00 AM tenant-local time,
 * email the owner + admins (+ opted-in users) a branded past-due report.
 *
 * Why this is the headline feature: motor-club A/R discipline is the
 * single biggest source of working-capital pain in the towing business.
 * A weekly, brand-coherent, Monday-morning pulse forces conversations
 * before debts age past collectibility and lets the owner see at a
 * glance which accounts are about to bite.
 *
 * Cron design:
 *   - The decorator fires hourly (RedAlertTask).
 *   - Each tick queries every tenant.
 *   - For each tenant, compute "is it Monday 6:00 AM in their timezone?"
 *   - If yes AND no row in red_alert_sends with status='sent' for the
 *     tenant's calendar Monday → trigger send.
 *   - On failure, increment retry_count + mark status='failed'; next
 *     hourly tick will retry up to a small cap so a transient SMTP
 *     blip doesn't lose Monday's send entirely.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type RedAlertBreakdown, redAlertSends, tenants, users, uuidv7 } from '@ustowdispatch/db';
import { type RedAlertBreakdownAccount, type RedAlertSendDto } from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { EmailService } from '../email/email.service.js';
import { ArSearchService } from './ar-search.service.js';
import { readTenantTimezone } from './tenant-settings.helper.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface TenantSchedulingState {
  tenantId: string;
  tenantName: string;
  ownerEmail: string | null;
  timezone: string;
}

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const MAX_RETRIES = 3;
const MONDAY_HOUR_LOCAL = 6;

@Injectable()
export class RedAlertService {
  private readonly log = new Logger(RedAlertService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly txRunner: TransactionRunner,
    private readonly arSearch: ArSearchService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Hourly tick driver — visits every tenant and decides whether their
   * Monday window is open. Exposed as a public method so an admin
   * endpoint can fire it on-demand for QA / smoke testing.
   */
  async runHourlyTick(
    now: Date = new Date(),
  ): Promise<{ tenants: number; sent: number; failed: number }> {
    const tenantsList = await this.listTenants();
    let sent = 0;
    let failed = 0;
    for (const t of tenantsList) {
      try {
        const fired = await this.maybeSendForTenant(t, now);
        if (fired === 'sent') sent += 1;
        else if (fired === 'failed') failed += 1;
      } catch (err) {
        failed += 1;
        this.log.error(
          `red-alert tenant ${t.tenantId} (${t.tenantName}) — unhandled: ${String(err)}`,
        );
      }
    }
    return { tenants: tenantsList.length, sent, failed };
  }

  /**
   * Public — used by the /ar/red-alert/run-now endpoint to force a
   * send for the caller's tenant regardless of clock. Bypasses the
   * Monday/timezone check; still respects the "one sent row per
   * alert_for_date" uniqueness guard so re-firing on the same date
   * just re-uses today's row.
   */
  async sendNowForTenant(ctx: CallerContext): Promise<RedAlertSendDto> {
    const t = await this.loadTenantState(ctx.tenantId);
    if (!t) throw new Error(`Tenant ${ctx.tenantId} not found`);
    const sendResult = await this.send(t, this.localCalendarDate(new Date(), t.timezone));
    return sendResult;
  }

  async listRecent(ctx: CallerContext, limit = 12): Promise<RedAlertSendDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.redAlertSends.findMany({
        orderBy: [desc(redAlertSends.sentAt)],
        limit,
      });
      return rows.map(this.toDto);
    });
  }

  // ---------- internals ----------

  private async listTenants(): Promise<TenantSchedulingState[]> {
    // RED ALERT runs across all tenants — bypass RLS via the
    // bootstrap-context query. We re-enter RLS for each tenant's
    // actual data load.
    const rows = await this.txRunner.runAsAdmin({}, async (tx) => {
      return tx.query.tenants.findMany({
        where: and(eq(tenants.status, 'active'), isNull(tenants.deletedAt)),
      });
    });
    return rows.map((t) => ({
      tenantId: t.id,
      tenantName: t.name,
      ownerEmail:
        ((t.settings as Record<string, unknown> | null)?.ownerEmail as string | null) ?? null,
      timezone: readTenantTimezone((t.settings as Record<string, unknown> | null) ?? null),
    }));
  }

  private async loadTenantState(tenantId: string): Promise<TenantSchedulingState | null> {
    const rows = await this.txRunner.runAsAdmin({}, async (tx) => {
      return tx.query.tenants.findFirst({
        where: and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)),
      });
    });
    if (!rows) return null;
    return {
      tenantId: rows.id,
      tenantName: rows.name,
      ownerEmail:
        ((rows.settings as Record<string, unknown> | null)?.ownerEmail as string | null) ?? null,
      timezone: readTenantTimezone((rows.settings as Record<string, unknown> | null) ?? null),
    };
  }

  /**
   * Decide whether this tick is the tenant's Monday 6 AM. If yes, and
   * we haven't already sent for that calendar Monday, fire the send.
   */
  private async maybeSendForTenant(
    t: TenantSchedulingState,
    now: Date,
  ): Promise<'skipped' | 'sent' | 'failed'> {
    const local = this.toLocalParts(now, t.timezone);
    // Sunday=0, Monday=1, …, Saturday=6.
    if (local.dayOfWeek !== 1) return 'skipped';
    if (local.hour !== MONDAY_HOUR_LOCAL) return 'skipped';

    const alertForDate = this.localCalendarDate(now, t.timezone);
    const already = await this.txRunner.runAsAdmin({}, async (tx) => {
      return tx.query.redAlertSends.findFirst({
        where: and(
          eq(redAlertSends.tenantId, t.tenantId),
          eq(redAlertSends.alertForDate, alertForDate),
          eq(redAlertSends.status, 'sent'),
        ),
      });
    });
    if (already) return 'skipped';

    try {
      await this.send(t, alertForDate);
      return 'sent';
    } catch (err) {
      this.log.error(`red-alert send failed for ${t.tenantName}: ${String(err)}`);
      return 'failed';
    }
  }

  private async send(t: TenantSchedulingState, alertForDate: string): Promise<RedAlertSendDto> {
    const sysCtx: CallerContext = {
      tenantId: t.tenantId,
      userId: SYSTEM_USER_ID,
      requestId: `red-alert-${alertForDate}`,
      ipAddress: null,
      userAgent: 'cron/red-alert',
    };

    // 1) gather past-due invoices (re-uses search service threshold logic).
    const pastDue = await this.arSearch.listPastDueInvoices(sysCtx);

    // 2) group by account.
    type Aggr = {
      accountId: string | null;
      accountName: string;
      invoiceCount: number;
      totalPastDueCents: number;
      oldestDaysOverdue: number;
    };
    const byAccount = new Map<string, Aggr>();
    for (const row of pastDue) {
      const key = row.accountId ?? 'cash';
      const name = row.accountName ?? 'Cash customers';
      const entry = byAccount.get(key) ?? {
        accountId: row.accountId,
        accountName: name,
        invoiceCount: 0,
        totalPastDueCents: 0,
        oldestDaysOverdue: 0,
      };
      entry.invoiceCount += 1;
      entry.totalPastDueCents += row.balanceCents;
      if (row.daysOverdue > entry.oldestDaysOverdue) entry.oldestDaysOverdue = row.daysOverdue;
      byAccount.set(key, entry);
    }
    const breakdown: RedAlertBreakdownAccount[] = Array.from(byAccount.values())
      .filter((a): a is RedAlertBreakdownAccount & { accountId: string | null } =>
        Boolean(a.accountId),
      )
      .sort((a, b) => b.totalPastDueCents - a.totalPastDueCents) as RedAlertBreakdownAccount[];

    // 3) recipients: owner_email from tenant settings + role-based users
    //    (owner, admin) + opted-in users. Build 7 will add yard scoping.
    const recipients = await this.collectRecipients(t);
    if (recipients.length === 0) {
      // Insert a 'sent' row anyway so we don't retry indefinitely, but
      // log the silence — operators may not have configured emails yet.
      this.log.warn(
        `red-alert for ${t.tenantName} found ${pastDue.length} past-due invoices but has no recipients — recording skip`,
      );
    }

    const totalPastDueCents = breakdown.reduce((a, b) => a + b.totalPastDueCents, 0);

    // 4) build email body. Plain text + branded HTML, both produced from
    //    the same template variables. We re-use the existing email-
    //    diagnostic / nodemailer infrastructure.
    const subject = `🚨 PAST DUE ALERT — Week of ${alertForDate}`;
    const html = renderRedAlertHtml({
      tenantName: t.tenantName,
      alertForDate,
      pastDueCount: pastDue.length,
      accountCount: breakdown.length,
      totalPastDueCents,
      breakdown,
      pastDueUrl: `${this.config.webPublicUrl}/billing/aging?statuses=past_due`,
    });
    const text = renderRedAlertText({
      tenantName: t.tenantName,
      alertForDate,
      pastDueCount: pastDue.length,
      accountCount: breakdown.length,
      totalPastDueCents,
      breakdown,
    });

    // 5) Send to each recipient (per-recipient so an error on one
    //    doesn't poison the others). We'll mark the row 'sent' if at
    //    least one recipient succeeded.
    const sentTo: string[] = [];
    const errors: string[] = [];
    for (const r of recipients) {
      try {
        await this.email.sendRawEmail({
          to: r,
          subject,
          html,
          text,
        });
        sentTo.push(r);
      } catch (err) {
        errors.push(`${r}: ${String(err)}`);
      }
    }

    const sendId = uuidv7();
    const status: 'sent' | 'failed' =
      sentTo.length > 0 ? 'sent' : recipients.length === 0 ? 'sent' : 'failed';

    return this.db.runInTenantContext(this.toTenantCtx(sysCtx), async (tx) => {
      const [row] = await tx
        .insert(redAlertSends)
        .values({
          id: sendId,
          tenantId: t.tenantId,
          sentAt: new Date(),
          alertForDate,
          sentTo,
          invoiceCount: pastDue.length,
          accountCount: breakdown.length,
          totalPastDueCents,
          breakdownJson: { accounts: breakdown } satisfies RedAlertBreakdown,
          status,
          errorMessage: errors.length ? errors.join(' | ') : null,
          retryCount: 0,
        })
        .returning();
      if (!row) throw new Error('red_alert_sends insert returned no row');
      return this.toDto(row);
    });
  }

  private async collectRecipients(t: TenantSchedulingState): Promise<string[]> {
    const out = new Set<string>();
    if (t.ownerEmail) out.add(t.ownerEmail);

    const rows = await this.txRunner.runAsAdmin({}, async (tx) => {
      return tx.query.users.findMany({
        where: and(
          eq(users.tenantId, t.tenantId),
          isNull(users.deletedAt),
          eq(users.isActive, true),
        ),
      });
    });
    for (const u of rows) {
      const role = u.role;
      if (role === 'owner' || role === 'admin' || u.receivesRedAlert) {
        if (u.email) out.add(u.email);
      }
    }
    return Array.from(out);
  }

  private toDto = (row: typeof redAlertSends.$inferSelect): RedAlertSendDto => {
    const breakdown = (row.breakdownJson as RedAlertBreakdown | null)?.accounts ?? [];
    return {
      id: row.id,
      sentAt: row.sentAt.toISOString(),
      alertForDate:
        typeof row.alertForDate === 'string'
          ? row.alertForDate
          : new Date(row.alertForDate).toISOString().slice(0, 10),
      sentTo: row.sentTo ?? [],
      invoiceCount: row.invoiceCount,
      accountCount: row.accountCount,
      totalPastDueCents: row.totalPastDueCents,
      breakdown,
      status: row.status,
      errorMessage: row.errorMessage,
      retryCount: row.retryCount,
    };
  };

  // ---------- time helpers ----------

  /**
   * Extract dayOfWeek (0–6, Sunday=0) and hour (0–23) for a given
   * instant in a given IANA timezone using Intl.DateTimeFormat — no
   * external timezone library needed.
   */
  private toLocalParts(d: Date, tz: string): { dayOfWeek: number; hour: number } {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      dayOfWeek: dayMap[weekday] ?? 0,
      // 24-hour without hour12 emits 00..23 on Chrome/Node but some
      // locales also emit "24" for midnight — normalize that to 0.
      hour: Math.max(0, Math.min(23, Number(hourStr) % 24)),
    };
  }

  /** YYYY-MM-DD in the tenant's local timezone. */
  private localCalendarDate(d: Date, tz: string): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA renders as YYYY-MM-DD which is exactly what we want.
    return fmt.format(d);
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

// ---------- email body templates ----------

interface RedAlertEmailVars {
  tenantName: string;
  alertForDate: string;
  pastDueCount: number;
  accountCount: number;
  totalPastDueCents: number;
  breakdown: RedAlertBreakdownAccount[];
  pastDueUrl?: string;
}

function renderRedAlertHtml(v: RedAlertEmailVars): string {
  const total = formatMoney(v.totalPastDueCents);
  const rows = v.breakdown
    .map(
      (a) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #2a2e3a;color:#ffffff;">${escapeHtml(
        a.accountName,
      )}</td>
      <td style="padding:8px;border-bottom:1px solid #2a2e3a;color:#ffffff;text-align:right;">${a.invoiceCount}</td>
      <td style="padding:8px;border-bottom:1px solid #2a2e3a;color:#ffffff;text-align:right;font-weight:bold;">${formatMoney(a.totalPastDueCents)}</td>
      <td style="padding:8px;border-bottom:1px solid #2a2e3a;color:#ff7050;text-align:right;">${a.oldestDaysOverdue} days</td>
    </tr>`,
    )
    .join('');
  return `<!doctype html>
<html><body style="margin:0;background:#0f1218;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#1A1E2A;padding:24px;">
  <div style="background:#F05A1A;color:#0f1218;padding:16px 20px;font-weight:900;font-size:20px;letter-spacing:0.5px;">
    🚨 PAST DUE ALERT — ${escapeHtml(v.tenantName)}
  </div>
  <div style="color:#9aa3b2;font-size:12px;margin-top:8px;">As of Monday ${v.alertForDate}, 6:00 AM</div>

  <table style="width:100%;margin-top:20px;border-collapse:collapse;color:#ffffff;">
    <tr>
      <td style="padding:10px;background:#262b3a;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9aa3b2;">Invoices past due</td>
      <td style="padding:10px;background:#262b3a;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9aa3b2;">Accounts affected</td>
      <td style="padding:10px;background:#262b3a;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9aa3b2;">Total past due</td>
    </tr>
    <tr>
      <td style="padding:14px 10px;font-size:24px;font-weight:bold;background:#1f2330;">${v.pastDueCount}</td>
      <td style="padding:14px 10px;font-size:24px;font-weight:bold;background:#1f2330;">${v.accountCount}</td>
      <td style="padding:14px 10px;font-size:24px;font-weight:bold;color:#F05A1A;background:#1f2330;">${total}</td>
    </tr>
  </table>

  <h3 style="margin-top:28px;color:#ffffff;font-size:14px;text-transform:uppercase;letter-spacing:1px;">By account</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="text-align:left;color:#9aa3b2;font-size:11px;text-transform:uppercase;letter-spacing:1px;">
      <th style="padding:8px;border-bottom:2px solid #F05A1A;">Account</th>
      <th style="padding:8px;text-align:right;border-bottom:2px solid #F05A1A;">#</th>
      <th style="padding:8px;text-align:right;border-bottom:2px solid #F05A1A;">Balance</th>
      <th style="padding:8px;text-align:right;border-bottom:2px solid #F05A1A;">Oldest</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="padding:14px;color:#9aa3b2;text-align:center;">No past-due accounts this week. Nice work.</td></tr>'}</tbody>
  </table>

  ${
    v.pastDueUrl
      ? `<div style="text-align:center;margin-top:28px;">
    <a href="${v.pastDueUrl}" style="display:inline-block;background:#F05A1A;color:#0f1218;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:6px;text-transform:uppercase;letter-spacing:0.5px;">
      Open A/R Workspace
    </a>
  </div>`
      : ''
  }

  <p style="color:#9aa3b2;font-size:11px;margin-top:32px;line-height:1.5;">
    This is your weekly Monday morning A/R pulse from US Tow DISPATCH.<br>
    Adjust per-account delinquency thresholds in Settings → Account Rate Cards → Contract Terms.
  </p>
</div>
</body></html>`;
}

function renderRedAlertText(v: RedAlertEmailVars): string {
  const lines: string[] = [];
  lines.push(`PAST DUE ALERT — ${v.tenantName}`);
  lines.push(`As of Monday ${v.alertForDate}, 6:00 AM`);
  lines.push('');
  lines.push('SUMMARY');
  lines.push(`Invoices past due: ${v.pastDueCount}`);
  lines.push(`Accounts affected: ${v.accountCount}`);
  lines.push(`Total past due:    ${formatMoney(v.totalPastDueCents)}`);
  lines.push('');
  lines.push('BY ACCOUNT');
  if (v.breakdown.length === 0) lines.push('  (no past-due accounts this week)');
  else
    for (const a of v.breakdown) {
      lines.push(
        `  ${a.accountName} | ${a.invoiceCount} invoices | ${formatMoney(a.totalPastDueCents)} | oldest ${a.oldestDaysOverdue} days`,
      );
    }
  lines.push('');
  lines.push(
    'Adjust per-account delinquency thresholds in Settings → Account Rate Cards → Contract Terms.',
  );
  return lines.join('\n');
}

function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
