/**
 * Sentry wrapper. Initialises @sentry/node lazily — if SENTRY_DSN is
 * empty (dev, tests, founder hasn't created the project yet), every
 * method is a no-op and no network calls are made.
 *
 * When enabled, every event is tagged with environment + service. Per-
 * request enrichment happens in the global exception filter, which calls
 * captureException(err, { tenantId, userId, requestId }) — those become
 * Sentry tags.
 *
 * PII scrubbing: Sentry's default scrubbing is on (passwords, auth headers,
 * cookies). Our config additionally denylists known custom PII fields.
 *
 * Performance traces: tracesSampleRate 0.1 in production, 0 elsewhere.
 *
 * Datadog: this is the integration point the spec asks for — there's a
 * dd-trace.ts neighbor file that does the same thing but for DD_API_KEY.
 * Flipping vendors is one env var.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';
import { ConfigService } from '../../config/config.service.js';

const PII_DENYLIST = ['email', 'phone', 'phoneAlt', 'passwordHash', 'refreshToken', 'totpSecret'];

@Injectable()
export class SentryService implements OnModuleInit {
  private enabled = false;
  private readonly logger: Logger;

  constructor(private readonly config: ConfigService) {
    this.logger = config.logger.child({ component: 'sentry' });
  }

  onModuleInit(): void {
    const dsn = this.config.sentryDsn;
    if (!dsn) {
      this.logger.info('Sentry disabled (no SENTRY_DSN)');
      return;
    }
    Sentry.init({
      dsn,
      environment: this.config.nodeEnv,
      release: this.config.releaseTag,
      tracesSampleRate: this.config.nodeEnv === 'production' ? 0.1 : 0,
      // We never want to leak PII into Sentry. Scrub before send.
      beforeSend(event) {
        if (event.user) {
          for (const key of PII_DENYLIST) {
            if (key in (event.user as Record<string, unknown>)) {
              delete (event.user as Record<string, unknown>)[key];
            }
          }
        }
        if (event.contexts) {
          for (const ctxKey of Object.keys(event.contexts)) {
            const ctx = event.contexts[ctxKey] as Record<string, unknown> | undefined;
            if (!ctx) continue;
            for (const key of PII_DENYLIST) if (key in ctx) ctx[key] = '[redacted]';
          }
        }
        return event;
      },
    });
    Sentry.setTag('service', 'towdispatch-api');
    this.enabled = true;
    this.logger.info({ environment: this.config.nodeEnv }, 'Sentry enabled');
  }

  captureException(
    err: unknown,
    ctx?: { tenantId?: string | null; userId?: string | null; requestId?: string },
  ): void {
    if (!this.enabled) return;
    Sentry.withScope((scope) => {
      if (ctx?.tenantId) scope.setTag('tenant_id', ctx.tenantId);
      if (ctx?.userId) scope.setUser({ id: ctx.userId });
      if (ctx?.requestId) scope.setTag('request_id', ctx.requestId);
      Sentry.captureException(err);
    });
  }

  captureMessage(message: string, ctx?: Record<string, string | number | null>): void {
    if (!this.enabled) return;
    Sentry.withScope((scope) => {
      if (ctx) for (const [k, v] of Object.entries(ctx)) if (v != null) scope.setTag(k, String(v));
      Sentry.captureMessage(message);
    });
  }

  /** Security events (token reuse, lockouts) get their own log line + Sentry breadcrumb. */
  recordSecurityEvent(name: string, ctx: Record<string, string | number | null>): void {
    this.logger.warn({ ...ctx, securityEvent: name }, `security event: ${name}`);
    this.captureMessage(`security:${name}`, ctx);
  }
}
