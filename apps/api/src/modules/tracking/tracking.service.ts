/**
 * TrackingService — owns tracking_links lifecycle, customer SMS dispatch,
 * and the message + rating writes from the public route.
 *
 * Two execution paths:
 *
 *   * AUTHENTICATED (dispatcher) — runs through TenantAwareDb.runInTenantContext
 *     so RLS scopes everything to the caller's tenant. Used by the resend,
 *     revoke, get-by-job endpoints.
 *
 *   * PUBLIC (customer with a token) — token is the unit of authorization.
 *     We resolve the token through TransactionRunner.runAsAdmin (admin pool,
 *     RLS bypassed) ONLY to look up the (tenant_id, job_id, expires_at,
 *     revoked_at) tuple. Once resolved, every subsequent read/write runs
 *     through runInTenantContext using the tenant id we just learned.
 *
 *     This is the design point the prompt calls out: "Token validation runs
 *     in middleware before any tenant context is established — token unlocks
 *     tenant scope, not the other way around." We do that resolution here so
 *     the service never trusts a tenant id that came from outside the token.
 */
import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  customers,
  driverShifts,
  drivers,
  jobRatings,
  jobs,
  trackingLinks,
  trackingMessages,
  trucks,
  uuidv7,
  vehicles,
} from '@towcommand/db';
import {
  DISPATCH_EVENTS,
  ERROR_CODES,
  type TrackingLanguage,
  type TrackingLinkDto,
  type TrackingMessageDto,
  type TrackingPublicView,
  trackingStatusLabel,
} from '@towcommand/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { NotificationService } from '../../integrations/notification/notification.service.js';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { TrackingRateLimitService } from './tracking-rate-limit.service.js';
import { generateTrackingToken } from './tracking-token.util.js';

interface AuthCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface ResolvedToken {
  trackingLinkId: string;
  tenantId: string;
  jobId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const MAX_MESSAGE_LEN = 1000;

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TrackingService.name);
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly events: DispatchEventsService,
    private readonly notifications: NotificationService,
    private readonly rateLimit: TrackingRateLimitService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Auto-generate a tracking link the first time a job lands in DISPATCHED.
    // We honor the per-job `_skip_customer_sms` flag stashed on the job's
    // notes (a transient marker the intake flow sets — see below).
    this.unsubscribe = this.events.subscribe(async (tenantId, event) => {
      if (event.name !== 'job.assigned') return;
      const payload = event.payload as { jobId: string; assignedByUserId: string };
      try {
        const skip = await this.shouldSkipSms(tenantId, payload.jobId);
        await this.onJobDispatched(
          {
            tenantId,
            userId: payload.assignedByUserId,
            requestId: `event:${payload.jobId}`,
            ipAddress: null,
            userAgent: null,
          },
          payload.jobId,
          skip,
        );
      } catch (err) {
        this.log.warn(
          `auto-create tracking link failed for job=${payload.jobId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * The intake form passes `skipCustomerSms: true` for fleet/account customers.
   * We persist the flag on the job's notes line as `[skip_customer_sms]` so a
   * subsequent re-assign also honors it. The dispatcher can override later
   * with the explicit resend endpoint.
   */
  private async shouldSkipSms(tenantId: string, jobId: string): Promise<boolean> {
    return this.admin.runAsAdmin({}, async (db) => {
      const j = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      const notes = j?.notes ?? '';
      return /\[skip_customer_sms\]/i.test(notes);
    });
  }

  // ====================== AUTH-SIDE (DISPATCHER) ======================

  /**
   * Generate (or reuse) the active tracking link for a job. Idempotent: if
   * a non-revoked, non-expired link already exists, returns it. Otherwise
   * inserts a new one. Optionally fires the SMS dispatch in the background.
   */
  async ensureForJob(
    ctx: AuthCtx,
    jobId: string,
    options: { sendSms: boolean; skipReason?: string } = { sendSms: true },
  ): Promise<TrackingLinkDto> {
    const link = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw notFound('Job not found');

      const existing = await tx.query.trackingLinks.findFirst({
        where: and(eq(trackingLinks.jobId, jobId), isNull(trackingLinks.revokedAt)),
      });
      if (existing && existing.expiresAt.getTime() > Date.now()) {
        return existing;
      }
      // Either no link, or the previous one expired without being revoked.
      // Revoke the expired one to keep the partial unique happy.
      if (existing) {
        await tx
          .update(trackingLinks)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(eq(trackingLinks.id, existing.id));
      }

      const ttlMs = this.config.notification.trackingLinkTtlHours * 60 * 60 * 1000;
      const id = uuidv7();
      const token = generateTrackingToken();
      const customerPhone = await this.lookupCustomerPhone(tx, job.customerId);
      const skipped = !!options.skipReason || !options.sendSms;
      const [row] = await tx
        .insert(trackingLinks)
        .values({
          id,
          tenantId: ctx.tenantId,
          jobId,
          token,
          expiresAt: new Date(Date.now() + ttlMs),
          smsToPhone: customerPhone,
          smsSkipped: skipped,
          smsStatus: skipped ? 'skipped' : 'pending',
        })
        .returning();
      if (!row) throw new Error('insert tracking_links .. returning() yielded no row');
      return row;
    });

    this.events.emit(ctx.tenantId, DISPATCH_EVENTS.TRACKING_LINK_CREATED, this.summaryEvent(link));

    if (options.sendSms && !options.skipReason) {
      // Fire-and-forget; failures land in sms_failed_reason via updateSmsResult.
      this.dispatchSmsForLink(ctx, link.id).catch((err) => {
        this.log.warn(
          `dispatchSmsForLink failed for link=${link.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    return this.linkToDto(link);
  }

  async getByJob(ctx: AuthCtx, jobId: string): Promise<TrackingLinkDto | null> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.trackingLinks.findFirst({
        where: and(eq(trackingLinks.jobId, jobId), isNull(trackingLinks.revokedAt)),
      });
      return row ? this.linkToDto(row) : null;
    });
  }

  async listMessagesForJob(ctx: AuthCtx, jobId: string): Promise<TrackingMessageDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.trackingMessages.findMany({
        where: eq(trackingMessages.jobId, jobId),
        orderBy: (t) => [asc(t.createdAt)],
      });
      return rows.map(messageToDto);
    });
  }

  async sendDispatcherMessage(
    ctx: AuthCtx,
    jobId: string,
    body: string,
  ): Promise<TrackingMessageDto> {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Message body is empty',
      });
    }
    if (trimmed.length > MAX_MESSAGE_LEN) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `Message body exceeds ${MAX_MESSAGE_LEN} characters`,
      });
    }
    const dto = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw notFound('Job not found');
      const link = await tx.query.trackingLinks.findFirst({
        where: and(eq(trackingLinks.jobId, jobId), isNull(trackingLinks.revokedAt)),
      });
      const id = uuidv7();
      const [row] = await tx
        .insert(trackingMessages)
        .values({
          id,
          tenantId: ctx.tenantId,
          jobId,
          trackingLinkId: link?.id ?? null,
          direction: 'outbound',
          senderUserId: ctx.userId,
          body: trimmed,
        })
        .returning();
      if (!row) throw new Error('insert tracking_messages .. returning() yielded no row');
      return messageToDto(row);
    });

    this.events.emit(ctx.tenantId, DISPATCH_EVENTS.TRACKING_MESSAGE_RECEIVED, {
      jobId,
      jobNumber: '',
      messageId: dto.id,
      direction: dto.direction,
      body: dto.body,
      createdAt: dto.createdAt,
    });
    return dto;
  }

  async resendSms(ctx: AuthCtx, jobId: string, override?: string): Promise<TrackingLinkDto> {
    const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const link = await tx.query.trackingLinks.findFirst({
        where: and(eq(trackingLinks.jobId, jobId), isNull(trackingLinks.revokedAt)),
      });
      if (!link) {
        // No active link — caller should use ensureForJob.
        throw notFound('No active tracking link for job; create one first');
      }
      // Reset status to pending; the SMS dispatch will overwrite.
      const [row] = await tx
        .update(trackingLinks)
        .set({
          smsStatus: 'pending',
          smsFailedReason: null,
          smsSkipped: false,
          smsToPhone: override ?? link.smsToPhone,
          updatedAt: new Date(),
        })
        .where(eq(trackingLinks.id, link.id))
        .returning();
      if (!row) throw new Error('update tracking_links .. returning() yielded no row');
      return row;
    });

    await this.dispatchSmsForLink(ctx, updated.id);
    return this.getByJob(ctx, jobId).then((d) => {
      if (!d) throw new Error('link disappeared after resend');
      return d;
    });
  }

  async revoke(ctx: AuthCtx, jobId: string): Promise<TrackingLinkDto | null> {
    const result = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const link = await tx.query.trackingLinks.findFirst({
        where: and(eq(trackingLinks.jobId, jobId), isNull(trackingLinks.revokedAt)),
      });
      if (!link) return null;
      const [row] = await tx
        .update(trackingLinks)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(trackingLinks.id, link.id))
        .returning();
      return row ?? null;
    });
    if (result) {
      this.events.emit(
        ctx.tenantId,
        DISPATCH_EVENTS.TRACKING_LINK_UPDATED,
        this.summaryEvent(result),
      );
    }
    return result ? this.linkToDto(result) : null;
  }

  // ====================== PUBLIC (CUSTOMER, BY TOKEN) ======================

  /**
   * Resolve a token to its (tenant_id, job_id) using the admin pool. Returns
   * null when the token does not exist; throws GoneException when the token
   * exists but is revoked or expired (so the public route returns 410).
   */
  async resolveToken(token: string): Promise<ResolvedToken | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.trackingLinks.findFirst({
        where: eq(trackingLinks.token, token),
      });
      if (!row) return null;
      if (row.revokedAt) {
        throw new GoneException({
          code: 'tracking_revoked',
          message: 'This tracking link has been revoked',
        });
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        throw new GoneException({
          code: 'tracking_expired',
          message: 'This tracking link has expired',
        });
      }
      return {
        trackingLinkId: row.id,
        tenantId: row.tenantId,
        jobId: row.jobId,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      };
    });
  }

  async publicView(
    token: string,
    ip: string | null,
    userAgent: string | null,
    lang: TrackingLanguage,
  ): Promise<TrackingPublicView> {
    const resolved = await this.resolveToken(token);
    if (!resolved) throw notFound('Unknown tracking link');

    // Per-IP rate limit: 60/min/IP. Tenant id is from the token; we still
    // bind on the ip so a single rogue IP can't burn the public surface.
    const rl = await this.rateLimit.hit(
      `view:${resolved.trackingLinkId}:${ip ?? 'unknown'}`,
      60,
      60,
    );
    if (!rl.allowed) {
      throw new BadRequestException({
        code: 'rate_limited',
        message: `Too many requests. Try again in ${rl.retryAfterSeconds}s.`,
      });
    }

    return this.db.runInTenantContext(
      {
        tenantId: resolved.tenantId,
        // No real user — we set the user id to the tenant id as a placeholder
        // so the audit trigger still has SOMETHING. Real audit events from
        // the public path are never PII-bearing.
        userId: resolved.tenantId,
        ...(ip ? { ipAddress: ip } : {}),
        ...(userAgent ? { userAgent } : {}),
      },
      async (tx) => {
        const link = await tx.query.trackingLinks.findFirst({
          where: eq(trackingLinks.id, resolved.trackingLinkId),
        });
        if (!link) throw notFound('Unknown tracking link');

        const job = await tx.query.jobs.findFirst({
          where: and(eq(jobs.id, link.jobId), isNull(jobs.deletedAt)),
        });
        if (!job) throw notFound('Job not found');

        const driver = job.assignedDriverId
          ? await tx.query.drivers.findFirst({
              where: eq(drivers.id, job.assignedDriverId),
            })
          : null;

        const truck = job.assignedTruckId
          ? await tx.query.trucks.findFirst({ where: eq(trucks.id, job.assignedTruckId) })
          : null;

        const shift = job.assignedShiftId
          ? await tx.query.driverShifts.findFirst({
              where: eq(driverShifts.id, job.assignedShiftId),
            })
          : null;

        const vehicle = job.vehicleId
          ? await tx.query.vehicles.findFirst({ where: eq(vehicles.id, job.vehicleId) })
          : null;

        const tenant = await tx.query.tenants.findFirst({
          where: (t, { eq: eqT }) => eqT(t.id, resolved.tenantId),
        });

        const rating = await tx.query.jobRatings.findFirst({
          where: eq(jobRatings.jobId, link.jobId),
        });

        // Update view bookkeeping in the same transaction.
        const now = new Date();
        await tx
          .update(trackingLinks)
          .set({
            firstViewedAt: link.firstViewedAt ?? now,
            lastViewedAt: now,
            viewCount: (link.viewCount ?? 0) + 1,
            lastViewedIp: ip,
            lastViewedUserAgent: userAgent,
            updatedAt: now,
          })
          .where(eq(trackingLinks.id, link.id));

        const tenantSettings = (tenant?.settings as Record<string, unknown> | null) ?? null;
        const branding = (tenantSettings?.branding as Record<string, unknown> | null) ?? null;
        const dispatch = (tenantSettings?.dispatch as Record<string, unknown> | null) ?? null;

        const view: TrackingPublicView = {
          jobNumber: job.jobNumber,
          status: job.status,
          statusLabel: trackingStatusLabel(
            job.status as Parameters<typeof trackingStatusLabel>[0],
            lang,
          ),
          serviceType: job.serviceType,
          pickupAddress: job.pickupAddress,
          dropoffAddress: job.dropoffAddress,
          driver: driver
            ? {
                firstName: driver.firstName,
                photoUrl: null,
                truckUnitNumber: truck?.unitNumber ?? null,
              }
            : null,
          driverLocation:
            shift?.lastLat && shift?.lastLng
              ? {
                  lat: Number(shift.lastLat),
                  lng: Number(shift.lastLng),
                  recordedAt: shift.lastPositionAt ? shift.lastPositionAt.toISOString() : null,
                }
              : null,
          pickup:
            job.pickupLat && job.pickupLng
              ? { lat: Number(job.pickupLat), lng: Number(job.pickupLng) }
              : null,
          vehicle: vehicle
            ? { year: vehicle.year, make: vehicle.make, model: vehicle.model }
            : null,
          tenant: {
            name: tenant?.name ?? '',
            logoUrl: typeof branding?.logoUrl === 'string' ? branding.logoUrl : null,
            primaryColor: typeof branding?.primaryColor === 'string' ? branding.primaryColor : null,
            accentColor: typeof branding?.accentColor === 'string' ? branding.accentColor : null,
            dispatchPhone: typeof dispatch?.phone === 'string' ? dispatch.phone : null,
          },
          language: lang,
          ratingSubmitted: !!rating,
          expired: link.expiresAt.getTime() <= Date.now(),
          completed:
            job.status === 'completed' || job.status === 'cancelled' || job.status === 'goa',
        };
        return view;
      },
    );
  }

  async listMessagesForToken(token: string): Promise<TrackingMessageDto[]> {
    const resolved = await this.resolveToken(token);
    if (!resolved) throw notFound('Unknown tracking link');
    return this.db.runInTenantContext(
      { tenantId: resolved.tenantId, userId: resolved.tenantId },
      async (tx) => {
        const rows = await tx.query.trackingMessages.findMany({
          where: eq(trackingMessages.jobId, resolved.jobId),
          orderBy: (t) => [asc(t.createdAt)],
        });
        return rows.map(messageToDto);
      },
    );
  }

  async submitCustomerMessage(
    token: string,
    body: string,
    ip: string | null,
  ): Promise<TrackingMessageDto> {
    const resolved = await this.resolveToken(token);
    if (!resolved) throw notFound('Unknown tracking link');

    // Two-bucket rate limit: 10/5min and 30/hour per token.
    const short = await this.rateLimit.hit(`msg-short:${resolved.trackingLinkId}`, 10, 300);
    if (!short.allowed) {
      throw new BadRequestException({
        code: 'rate_limited',
        message: `Too many messages. Try again in ${short.retryAfterSeconds}s.`,
      });
    }
    const long = await this.rateLimit.hit(`msg-long:${resolved.trackingLinkId}`, 30, 3600);
    if (!long.allowed) {
      throw new BadRequestException({
        code: 'rate_limited',
        message: `Too many messages this hour. Try again in ${long.retryAfterSeconds}s.`,
      });
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Message body is empty',
      });
    }
    if (trimmed.length > MAX_MESSAGE_LEN) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `Message body exceeds ${MAX_MESSAGE_LEN} characters`,
      });
    }

    const dto = await this.db.runInTenantContext(
      {
        tenantId: resolved.tenantId,
        userId: resolved.tenantId,
        ...(ip ? { ipAddress: ip } : {}),
      },
      async (tx) => {
        const id = uuidv7();
        const [row] = await tx
          .insert(trackingMessages)
          .values({
            id,
            tenantId: resolved.tenantId,
            jobId: resolved.jobId,
            trackingLinkId: resolved.trackingLinkId,
            direction: 'inbound',
            body: trimmed,
          })
          .returning();
        if (!row) throw new Error('insert tracking_messages .. returning() yielded no row');
        return messageToDto(row);
      },
    );

    // Look up job number for the dispatch event payload.
    const jobNumber = await this.db
      .runInTenantContext(
        { tenantId: resolved.tenantId, userId: resolved.tenantId },
        async (tx) => {
          const j = await tx.query.jobs.findFirst({ where: eq(jobs.id, resolved.jobId) });
          return j?.jobNumber ?? '';
        },
      )
      .catch(() => '');

    this.events.emit(resolved.tenantId, DISPATCH_EVENTS.TRACKING_MESSAGE_RECEIVED, {
      jobId: resolved.jobId,
      jobNumber,
      messageId: dto.id,
      direction: dto.direction,
      body: dto.body,
      createdAt: dto.createdAt,
    });
    return dto;
  }

  async submitRating(
    token: string,
    stars: number,
    comment: string | null,
    ip: string | null,
  ): Promise<{ ok: true }> {
    const resolved = await this.resolveToken(token);
    if (!resolved) throw notFound('Unknown tracking link');

    // 5 attempts / 10min. Submitting twice is fine (we upsert), but a binder
    // attack on the comment field still gets blunted.
    const rl = await this.rateLimit.hit(`rate:${resolved.trackingLinkId}`, 5, 600);
    if (!rl.allowed) {
      throw new BadRequestException({
        code: 'rate_limited',
        message: `Too many attempts. Try again in ${rl.retryAfterSeconds}s.`,
      });
    }

    if (stars < 1 || stars > 5) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Stars must be between 1 and 5',
      });
    }

    await this.db.runInTenantContext(
      {
        tenantId: resolved.tenantId,
        userId: resolved.tenantId,
        ...(ip ? { ipAddress: ip } : {}),
      },
      async (tx) => {
        // Upsert by (tenant_id, job_id) — partial unique. Last write wins.
        const existing = await tx.query.jobRatings.findFirst({
          where: eq(jobRatings.jobId, resolved.jobId),
        });
        if (existing) {
          await tx
            .update(jobRatings)
            .set({ stars, comment: comment ?? null })
            .where(eq(jobRatings.id, existing.id));
        } else {
          await tx.insert(jobRatings).values({
            id: uuidv7(),
            tenantId: resolved.tenantId,
            jobId: resolved.jobId,
            trackingLinkId: resolved.trackingLinkId,
            stars,
            comment: comment ?? null,
            submittedFromIp: ip,
          });
        }
      },
    );

    return { ok: true };
  }

  // ====================== REPORTING ======================

  async reportingSummary(ctx: AuthCtx): Promise<{
    smsSent: number;
    smsDelivered: number;
    smsFailed: number;
    smsSkipped: number;
    linksViewed: number;
    avgTimeToFirstViewSeconds: number | null;
    ratingsCount: number;
    avgRating: number | null;
  }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const links = await tx.query.trackingLinks.findMany({
        where: eq(trackingLinks.tenantId, ctx.tenantId),
      });
      const ratings = await tx.query.jobRatings.findMany({
        where: eq(jobRatings.tenantId, ctx.tenantId),
      });

      const smsSent = links.filter(
        (l) => l.smsStatus === 'sent' || l.smsStatus === 'delivered',
      ).length;
      const smsDelivered = links.filter((l) => l.smsStatus === 'delivered').length;
      const smsFailed = links.filter((l) => l.smsStatus === 'failed').length;
      const smsSkipped = links.filter((l) => l.smsStatus === 'skipped').length;
      const linksViewed = links.filter((l) => !!l.firstViewedAt).length;

      const viewLatencies: number[] = [];
      for (const l of links) {
        const viewed = l.firstViewedAt;
        const sent = l.smsSentAt;
        if (!viewed || !sent) continue;
        viewLatencies.push(Math.max(0, Math.floor((viewed.getTime() - sent.getTime()) / 1000)));
      }
      const avgTimeToFirstViewSeconds =
        viewLatencies.length > 0
          ? Math.round(viewLatencies.reduce((a, b) => a + b, 0) / viewLatencies.length)
          : null;

      const ratingsCount = ratings.length;
      const avgRating =
        ratingsCount > 0
          ? Number((ratings.reduce((acc, r) => acc + Number(r.stars), 0) / ratingsCount).toFixed(2))
          : null;

      return {
        smsSent,
        smsDelivered,
        smsFailed,
        smsSkipped,
        linksViewed,
        avgTimeToFirstViewSeconds,
        ratingsCount,
        avgRating,
      };
    });
  }

  // ====================== INTERNAL HELPERS ======================

  /**
   * Hook called by JobsService when a job moves to DISPATCHED. Idempotent.
   * Caller is the dispatcher whose action triggered the transition, so we
   * have a real auth ctx.
   */
  async onJobDispatched(ctx: AuthCtx, jobId: string, skipSms: boolean): Promise<void> {
    try {
      await this.ensureForJob(ctx, jobId, {
        sendSms: !skipSms,
        ...(skipSms ? { skipReason: 'dispatcher_opt_out' } : {}),
      });
    } catch (err) {
      // Don't fail the dispatch transition on a tracking glitch — log loudly
      // and keep the job moving.
      this.log.error(
        `onJobDispatched failed jobId=${jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async handleProviderWebhookStatus(
    externalId: string,
    status: 'queued' | 'sent' | 'delivered' | 'failed',
    failureReason?: string,
  ): Promise<void> {
    // No tenant context yet — find the row by externalId via admin pool.
    const found = await this.admin.runAsAdmin({}, async (db) => {
      return db.query.trackingLinks.findFirst({
        where: eq(trackingLinks.smsExternalId, externalId),
      });
    });
    if (!found) return;
    await this.db.runInTenantContext(
      { tenantId: found.tenantId, userId: found.tenantId },
      async (tx) => {
        const update: Record<string, unknown> = {
          smsStatus: status,
          updatedAt: new Date(),
        };
        if (status === 'delivered') update.smsDeliveredAt = new Date();
        if (status === 'failed' && failureReason) update.smsFailedReason = failureReason;
        await tx.update(trackingLinks).set(update).where(eq(trackingLinks.id, found.id));
      },
    );
  }

  private async dispatchSmsForLink(ctx: AuthCtx, linkId: string): Promise<void> {
    // Read state inside a tenant context so we know we're not crossing.
    const link = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.trackingLinks.findFirst({
        where: eq(trackingLinks.id, linkId),
      });
      return row;
    });
    if (!link) return;
    if (link.smsSkipped) return;

    const tenant = await this.admin.runAsAdmin({}, async (db) => {
      return db.query.tenants.findFirst({
        where: (t, { eq: eqT }) => eqT(t.id, link.tenantId),
      });
    });

    const customerPhone = link.smsToPhone;
    if (!customerPhone) {
      await this.markSmsResult(link.id, link.tenantId, 'failed', 'no_customer_phone');
      return;
    }

    const tenantSettings = (tenant?.settings as Record<string, unknown> | null) ?? null;
    const sms = (tenantSettings?.sms as Record<string, unknown> | null) ?? null;
    const customBody = typeof sms?.body === 'string' ? sms.body : null;
    const template = customBody ?? this.config.notification.smsDefaultBody;

    const trackingUrl = `${this.config.webPublicUrl.replace(/\/$/, '')}/track/${link.token}`;
    const body = template
      .replace(/\{\{tracking_url\}\}/g, trackingUrl)
      .replace(/\{\{tenant_name\}\}/g, tenant?.name ?? 'TowCommand');

    const result = await this.notifications.sendSms({
      tenantId: link.tenantId,
      to: customerPhone,
      body,
      clientReference: link.id,
    });

    await this.markSmsResult(
      link.id,
      link.tenantId,
      result.status,
      result.error ?? null,
      result.externalId || null,
    );
  }

  private async markSmsResult(
    linkId: string,
    tenantId: string,
    status: 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped' | 'pending',
    failureReason: string | null,
    externalId?: string | null,
  ): Promise<void> {
    await this.db.runInTenantContext({ tenantId, userId: tenantId }, async (tx) => {
      const update: Record<string, unknown> = {
        smsStatus: status,
        updatedAt: new Date(),
      };
      if (status === 'sent' || status === 'queued' || status === 'delivered') {
        update.smsSentAt = new Date();
      }
      if (status === 'delivered') update.smsDeliveredAt = new Date();
      if (status === 'failed' && failureReason) update.smsFailedReason = failureReason;
      if (externalId) update.smsExternalId = externalId;
      await tx.update(trackingLinks).set(update).where(eq(trackingLinks.id, linkId));
    });
    // After the write, re-emit a summary so the dispatch board updates the
    // badge state.
    const updated = await this.db
      .runInTenantContext({ tenantId, userId: tenantId }, async (tx) => {
        return tx.query.trackingLinks.findFirst({ where: eq(trackingLinks.id, linkId) });
      })
      .catch(() => null);
    if (updated) {
      this.events.emit(tenantId, DISPATCH_EVENTS.TRACKING_LINK_UPDATED, this.summaryEvent(updated));
    }
  }

  private async lookupCustomerPhone(tx: Tx, customerId: string | null): Promise<string | null> {
    if (!customerId) return null;
    const row = await tx.query.customers.findFirst({
      where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
    });
    // Strip everything but digits and the leading + so Twilio is happy.
    const phone = row?.phone ?? null;
    if (!phone) return null;
    const cleaned = phone.startsWith('+')
      ? `+${phone.slice(1).replace(/\D+/g, '')}`
      : phone.replace(/\D+/g, '');
    return cleaned || null;
  }

  private linkToDto(link: typeof trackingLinks.$inferSelect): TrackingLinkDto {
    const url = `${this.config.webPublicUrl.replace(/\/$/, '')}/track/${link.token}`;
    return {
      id: link.id,
      jobId: link.jobId,
      token: link.token,
      url,
      smsStatus: link.smsStatus,
      smsToPhone: link.smsToPhone,
      smsSentAt: link.smsSentAt ? link.smsSentAt.toISOString() : null,
      smsDeliveredAt: link.smsDeliveredAt ? link.smsDeliveredAt.toISOString() : null,
      smsFailedReason: link.smsFailedReason,
      firstViewedAt: link.firstViewedAt ? link.firstViewedAt.toISOString() : null,
      lastViewedAt: link.lastViewedAt ? link.lastViewedAt.toISOString() : null,
      viewCount: link.viewCount ?? 0,
      expiresAt: link.expiresAt.toISOString(),
      revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
    };
  }

  private summaryEvent(link: typeof trackingLinks.$inferSelect): {
    jobId: string;
    jobNumber: string;
    trackingLinkId: string;
    smsStatus: string;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    viewCount: number;
    expiresAt: string;
    revokedAt: string | null;
  } {
    return {
      jobId: link.jobId,
      jobNumber: '',
      trackingLinkId: link.id,
      smsStatus: link.smsStatus,
      firstViewedAt: link.firstViewedAt ? link.firstViewedAt.toISOString() : null,
      lastViewedAt: link.lastViewedAt ? link.lastViewedAt.toISOString() : null,
      viewCount: link.viewCount ?? 0,
      expiresAt: link.expiresAt.toISOString(),
      revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
    };
  }

  private toTenantCtx(ctx: AuthCtx): {
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

function messageToDto(row: {
  id: string;
  direction: 'inbound' | 'outbound' | 'system';
  body: string;
  createdAt: Date;
}): TrackingMessageDto {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = (msg: string): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: msg });
