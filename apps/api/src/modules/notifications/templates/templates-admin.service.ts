/**
 * TemplatesAdminService — list / upsert / preview templates from the admin UI.
 *
 * Listing is unioned: every (template_key, channel) the platform supports
 * shows up once with either the tenant row's content or the system default,
 * with `isOverride` indicating which. Upsert always lands a tenant_id row;
 * deleting an override reverts to system default.
 */
import { Injectable } from '@nestjs/common';
import {
  notificationTemplates,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  NotificationChannel,
  NotificationTemplateDto,
  PreviewTemplatePayload,
  UpsertTemplatePayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import Handlebars from 'handlebars';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { TemplateLoaderService } from './template-loader.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class TemplatesAdminService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly loader: TemplateLoaderService,
  ) {}

  async list(ctx: CallerContext): Promise<NotificationTemplateDto[]> {
    return this.admin.runAsAdmin({ actorUserId: ctx.userId }, async (tx) => {
      const systemRows = await tx
        .select()
        .from(notificationTemplates)
        .where(isNull(notificationTemplates.tenantId));
      const tenantRows = await tx
        .select()
        .from(notificationTemplates)
        .where(eq(notificationTemplates.tenantId, ctx.tenantId));
      const out: NotificationTemplateDto[] = [];
      const keys = new Set<string>();
      for (const row of [...tenantRows, ...systemRows]) {
        const key = `${row.templateKey}|${row.channel}`;
        if (keys.has(key)) continue;
        const isOverride = row.tenantId !== null;
        keys.add(key);
        out.push({
          id: row.id,
          tenantId: row.tenantId,
          templateKey: row.templateKey,
          channel: row.channel as NotificationChannel,
          subject: row.subject,
          body: row.body,
          bodyPlain: row.bodyPlain,
          variablesSchema: Array.isArray(row.variablesSchema) ? (row.variablesSchema as unknown[]) : [],
          active: row.active,
          isOverride,
        });
      }
      return out;
    });
  }

  async upsert(ctx: CallerContext, body: UpsertTemplatePayload): Promise<NotificationTemplateDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        const existing = await tx
          .select({ id: notificationTemplates.id })
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.tenantId, ctx.tenantId),
              eq(notificationTemplates.templateKey, body.templateKey),
              eq(notificationTemplates.channel, body.channel),
            ),
          )
          .limit(1);
        let id: string;
        if (existing[0]) {
          id = existing[0].id;
          await tx
            .update(notificationTemplates)
            .set({
              subject: body.subject ?? null,
              body: body.body,
              bodyPlain: body.bodyPlain ?? null,
              active: body.active ?? true,
              updatedAt: new Date(),
            })
            .where(eq(notificationTemplates.id, id));
        } else {
          id = uuidv7();
          await tx.insert(notificationTemplates).values({
            id,
            tenantId: ctx.tenantId,
            templateKey: body.templateKey,
            channel: body.channel,
            subject: body.subject ?? null,
            body: body.body,
            bodyPlain: body.bodyPlain ?? null,
            variablesSchema: [],
            active: body.active ?? true,
          });
        }
        this.loader.invalidate(ctx.tenantId, body.templateKey, body.channel);
        return {
          id,
          tenantId: ctx.tenantId,
          templateKey: body.templateKey,
          channel: body.channel,
          subject: body.subject ?? null,
          body: body.body,
          bodyPlain: body.bodyPlain ?? null,
          variablesSchema: [],
          active: body.active ?? true,
          isOverride: true,
        };
      },
    );
  }

  async preview(
    ctx: CallerContext,
    body: PreviewTemplatePayload,
  ): Promise<{ subject: string | null; body: string; bodyPlain: string | null }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async () => {
        // Render via the loader so tenant overrides apply.
        const rendered = await this.loader.render({
          tenantId: ctx.tenantId,
          templateKey: body.templateKey,
          channel: body.channel,
          payload: body.payload,
        });
        return {
          subject: rendered.subject,
          body: rendered.body,
          bodyPlain: rendered.bodyPlain,
        };
      },
    );
  }

  /** Validate Handlebars syntax client-side before save. Throws on parse error. */
  static validateSyntax(body: string): void {
    try {
      Handlebars.precompile(body);
    } catch (err) {
      throw new Error(`Invalid Handlebars: ${(err as Error).message}`);
    }
  }
}
