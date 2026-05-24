/**
 * TemplateLoader — resolves (templateKey, channel) → compiled Handlebars
 * with tenant-override-over-system-default semantics, and renders.
 *
 * Storage:
 *   - System defaults live in notification_templates with tenant_id IS NULL
 *     (seeded by upsertSystemTemplates() at boot).
 *   - Tenant overrides are full rows with tenant_id set.
 *
 * Caching:
 *   - In-memory compiled-template cache keyed by (scope, key, channel).
 *     "scope" is either 'system' or the tenant uuid. Invalidated on update.
 *
 * Why two reads per resolve (tenant then system): the tenant override doesn't
 * have to cover every channel. A tenant might override only the email body
 * for invoice_created and inherit the push variant. Resolving per-channel
 * keeps the override surface minimal.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import { notificationTemplates } from '@ustowdispatch/db';
import type { NotificationChannel } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import Handlebars, { type TemplateDelegate } from 'handlebars';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { SYSTEM_TEMPLATES, type SystemTemplate } from './system-templates.js';

const handlebars = Handlebars.create();

// Helper for webhook JSON payloads — emits valid JSON without HTML escaping.
handlebars.registerHelper('json', (ctx: unknown) => new handlebars.SafeString(JSON.stringify(ctx ?? null)));
// Date helpers — kept tiny on purpose; tenants override if they need fancy.
handlebars.registerHelper('formatDate', (iso: unknown) => {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
});
handlebars.registerHelper('formatTime', (iso: unknown) => {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
});

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  bodyPlain: string | null;
  templateRowId: string | null;
  isOverride: boolean;
}

interface CompiledTemplate {
  rowId: string | null;
  subjectFn: TemplateDelegate | null;
  bodyFn: TemplateDelegate;
  bodyPlainFn: TemplateDelegate | null;
  isOverride: boolean;
}

@Injectable()
export class TemplateLoaderService implements OnModuleInit {
  private readonly log = new Logger(TemplateLoaderService.name);
  private readonly cache = new Map<string, CompiledTemplate>();

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.upsertSystemTemplates();
    } catch (err) {
      // Schema not yet migrated in some test environments; log and continue.
      this.log.warn(`upsertSystemTemplates skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Idempotent seed. Inserts any system template that isn't already present
   * (matched by (template_key, channel) where tenant_id IS NULL).
   */
  async upsertSystemTemplates(): Promise<void> {
    await this.admin.runAsAdmin({}, async (db) => {
      for (const tpl of SYSTEM_TEMPLATES) {
        const existing = await db
          .select({ id: notificationTemplates.id })
          .from(notificationTemplates)
          .where(
            and(
              isNull(notificationTemplates.tenantId),
              eq(notificationTemplates.templateKey, tpl.templateKey),
              eq(notificationTemplates.channel, tpl.channel),
            ),
          )
          .limit(1);
        if (existing.length > 0) continue;
        await db.insert(notificationTemplates).values({
          id: uuidv7(),
          tenantId: null,
          templateKey: tpl.templateKey,
          channel: tpl.channel,
          subject: tpl.subject,
          body: tpl.body,
          bodyPlain: tpl.bodyPlain,
          variablesSchema: tpl.variablesSchema as unknown as unknown[],
          active: true,
        });
      }
    });
  }

  /**
   * Render a template for a tenant. Caller passes the open tx so the
   * RLS-scoped read picks up tenant overrides.
   */
  async render(args: {
    tenantId: string;
    templateKey: string;
    channel: NotificationChannel;
    payload: Record<string, unknown>;
  }): Promise<RenderedTemplate> {
    const compiled = await this.resolve(args.tenantId, args.templateKey, args.channel);
    if (!compiled) {
      // Fallback to webhook default for webhook channel, or a stub line for
      // dev. We don't throw — caller will record a suppressed delivery.
      if (args.channel === 'webhook') {
        const fallback = SYSTEM_TEMPLATES.find(
          (t) => t.templateKey === '__webhook_default__' && t.channel === 'webhook',
        );
        if (fallback) {
          return this.renderInline(fallback, args.payload, true);
        }
      }
      return {
        subject: null,
        body: `[no template: ${args.templateKey}/${args.channel}]`,
        bodyPlain: null,
        templateRowId: null,
        isOverride: false,
      };
    }
    return this.renderCompiled(compiled, args.payload);
  }

  /**
   * Force a re-fetch for a (tenantId, templateKey, channel) tuple. Called
   * by the admin upsert handler.
   */
  invalidate(tenantId: string | null, templateKey: string, channel: NotificationChannel): void {
    this.cache.delete(this.cacheKey(tenantId ?? 'system', templateKey, channel));
    if (tenantId) {
      // Also drop the per-tenant key so the next read re-evaluates.
      this.cache.delete(this.cacheKey(tenantId, templateKey, channel));
    }
  }

  private async resolve(
    tenantId: string,
    templateKey: string,
    channel: NotificationChannel,
  ): Promise<CompiledTemplate | null> {
    const tenantCacheKey = this.cacheKey(tenantId, templateKey, channel);
    const cached = this.cache.get(tenantCacheKey);
    if (cached) return cached;

    // 1. Tenant override
    const override = await this.admin.runAsAdmin({}, async (db) => {
      const rows = await db
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.tenantId, tenantId),
            eq(notificationTemplates.templateKey, templateKey),
            eq(notificationTemplates.channel, channel),
            eq(notificationTemplates.active, true),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });
    if (override) {
      const compiled = this.compile(override, true);
      this.cache.set(tenantCacheKey, compiled);
      return compiled;
    }

    // 2. System default
    const systemKey = this.cacheKey('system', templateKey, channel);
    const sysCached = this.cache.get(systemKey);
    if (sysCached) {
      this.cache.set(tenantCacheKey, sysCached);
      return sysCached;
    }
    const sys = await this.admin.runAsAdmin({}, async (db) => {
      const rows = await db
        .select()
        .from(notificationTemplates)
        .where(
          and(
            isNull(notificationTemplates.tenantId),
            eq(notificationTemplates.templateKey, templateKey),
            eq(notificationTemplates.channel, channel),
            eq(notificationTemplates.active, true),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });
    if (sys) {
      const compiled = this.compile(sys, false);
      this.cache.set(systemKey, compiled);
      this.cache.set(tenantCacheKey, compiled);
      return compiled;
    }

    // 3. In-memory bundled fallback (covers fresh boots before upsert ran).
    const bundled = SYSTEM_TEMPLATES.find(
      (t) => t.templateKey === templateKey && t.channel === channel,
    );
    if (bundled) {
      const compiled: CompiledTemplate = {
        rowId: null,
        subjectFn: bundled.subject ? handlebars.compile(bundled.subject) : null,
        bodyFn: handlebars.compile(bundled.body),
        bodyPlainFn: bundled.bodyPlain ? handlebars.compile(bundled.bodyPlain) : null,
        isOverride: false,
      };
      this.cache.set(systemKey, compiled);
      this.cache.set(tenantCacheKey, compiled);
      return compiled;
    }

    return null;
  }

  private compile(
    row: { id: string; subject: string | null; body: string; bodyPlain: string | null },
    isOverride: boolean,
  ): CompiledTemplate {
    return {
      rowId: row.id,
      subjectFn: row.subject ? handlebars.compile(row.subject) : null,
      bodyFn: handlebars.compile(row.body),
      bodyPlainFn: row.bodyPlain ? handlebars.compile(row.bodyPlain) : null,
      isOverride,
    };
  }

  private renderCompiled(
    compiled: CompiledTemplate,
    payload: Record<string, unknown>,
  ): RenderedTemplate {
    return {
      subject: compiled.subjectFn ? compiled.subjectFn(payload) : null,
      body: compiled.bodyFn(payload),
      bodyPlain: compiled.bodyPlainFn ? compiled.bodyPlainFn(payload) : null,
      templateRowId: compiled.rowId,
      isOverride: compiled.isOverride,
    };
  }

  private renderInline(
    tpl: SystemTemplate,
    payload: Record<string, unknown>,
    _treatAsOverride: boolean,
  ): RenderedTemplate {
    const subj = tpl.subject ? handlebars.compile(tpl.subject)(payload) : null;
    const body = handlebars.compile(tpl.body)(payload);
    const plain = tpl.bodyPlain ? handlebars.compile(tpl.bodyPlain)(payload) : null;
    return { subject: subj, body, bodyPlain: plain, templateRowId: null, isOverride: false };
  }

  private cacheKey(scope: string, key: string, channel: NotificationChannel): string {
    return `${scope}|${key}|${channel}`;
  }
}
