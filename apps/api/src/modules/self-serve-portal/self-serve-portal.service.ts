/**
 * SelfServePortalService — the account-less, per-impound owner portal
 * (Session 55). Tenant is resolved from the request Host (reusing the S32
 * white-label host util); there is no authenticated principal, so:
 *   - tenant resolution runs on the admin pool (RLS-bypass; tenant unknown),
 *   - all tenant-scoped work runs in runInTenantContext({tenantId, SYSTEM})
 *     so FORCE RLS enforces isolation (defense-in-depth) and the audit actor
 *     is the system sentinel — exactly the posture the Stripe webhook uses.
 *
 * Flow: lookup -> magic link (SMS-first/email-fallback) -> verify (session
 * cookie) -> self-attest ID -> balance -> release intent + Stripe pay ->
 * ready_for_gate. The gate operator physically re-verifies and finishes the
 * release. Card data never touches the server (Stripe Elements client-side).
 *
 * NOTE: the S22 impound_records model carries no owner-contact / case-number
 * columns, so v1 lookup matches plate/VIN and case=impound id; owner lastName
 * lookup + magic-link delivery to the owner's phone/email are wired through a
 * best-effort contact resolver and degrade to a clear no-channel error until
 * the impound→customer contact join lands (documented in SESSION_55_REPORT).
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  customerPortalIdVerifications,
  customerPortalPayments,
  customerPortalReleaseIntents,
  customerPortalSessions,
  impoundFees,
  impoundRecords,
  impoundYards,
  tenants,
  uuidv7,
} from '@ustowdispatch/db';
import {
  ERROR_CODES,
  type PortalBalance,
  type PortalIdAttestPayload,
  type PortalIdVerificationDto,
  type PortalLookupPayload,
  type PortalLookupResult,
  type PortalPayInitResult,
  type PortalReleaseIntentDto,
  type PortalSessionView,
  canTransitionReleaseIntent,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { NotificationService } from '../../integrations/notification/notification.service.js';
import { normalizeHost } from '../customer-portal/portal-host.util.js';
import { PAYMENT_PROVIDER } from '../payments/payments.tokens.js';
import type { PaymentProvider } from '../payments/provider.js';
import { RateLimiterService } from '../redis/rate-limiter.service.js';
import { encryptIdLast4 } from './id-cipher.js';
import {
  type LookupCandidate,
  candidateMatches,
  classifyMatches,
  normalizeLookupQuery,
} from './lookup/lookup-matching.js';
import {
  LOOKUP_RATE_LIMIT,
  LOOKUP_RATE_WINDOW_SECONDS,
  MAGIC_LINK_RATE_LIMIT,
  MAGIC_LINK_RATE_WINDOW_SECONDS,
  lookupRateKey,
  magicLinkRateKey,
} from './lookup/rate-limit-policy.js';
import { magicLinkSms } from './notifications/portal-messages.js';
import { computeBalance } from './payment/balance-math.js';
import {
  type SessionTokenPayload,
  signSessionToken,
  verifySessionToken,
} from './session/session-token.js';

/** System audit actor for unauthenticated portal writes (mirrors the webhook). */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
}

@Injectable()
export class SelfServePortalService {
  private readonly log;

  constructor(
    private readonly config: ConfigService,
    private readonly tenantDb: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly notifications: NotificationService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {
    this.log = config.logger.child({ component: 'self-serve-portal' });
  }

  private requireEnabled(): void {
    if (!this.config.selfServePortal.enabled) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Customer self-serve portal is not enabled',
      });
    }
  }

  private requirePaymentEnabled(): void {
    if (!this.config.selfServePortal.paymentEnabled) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Self-serve portal payments are not enabled',
      });
    }
  }

  /** Resolve tenant from Host on the admin pool (tenant unknown pre-session). */
  async resolveTenantByHost(rawHost: string): Promise<ResolvedTenant> {
    const host = normalizeHost(rawHost);
    if (!host)
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Unknown host' });
    const slug = host.split('.')[0] ?? '';
    const tenant = await this.admin.runAsAdmin({}, async (db) =>
      db.query.tenants.findFirst({
        where: and(eq(tenants.slug, slug), isNull(tenants.deletedAt)),
        columns: { id: true, slug: true, name: true, status: true },
      }),
    );
    if (!tenant || tenant.status !== 'active') {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Unknown host' });
    }
    return { id: tenant.id, slug: tenant.slug, name: tenant.name };
  }

  // ===========================================================================
  // LOOKUP + MAGIC LINK
  // ===========================================================================

  async lookup(
    rawHost: string,
    ip: string | null,
    userAgent: string | null,
    payload: PortalLookupPayload,
  ): Promise<PortalLookupResult> {
    this.requireEnabled();
    const tenant = await this.resolveTenantByHost(rawHost);

    const rl = await this.rateLimiter.check(
      lookupRateKey(tenant.id, ip),
      LOOKUP_RATE_LIMIT,
      LOOKUP_RATE_WINDOW_SECONDS,
    );
    if (!rl.allowed) {
      throw new BadRequestException({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many lookups — please wait and try again',
      });
    }

    // Read candidate impounds under RLS (only this tenant's live, non-released
    // vehicles are eligible for self-serve recovery).
    const candidates = await this.tenantDb.runInTenantContext(
      { tenantId: tenant.id, userId: SYSTEM_ACTOR },
      async (tx): Promise<LookupCandidate[]> => {
        const rows = await tx.query.impoundRecords.findMany({
          where: and(isNull(impoundRecords.deletedAt)),
          columns: {
            id: true,
            licensePlate: true,
            vehicleVin: true,
            status: true,
          },
        });
        return rows
          .filter((r) => r.status === 'stored' || r.status === 'pending_release')
          .map((r) => ({
            impoundId: r.id,
            caseNumber: r.id,
            licensePlate: r.licensePlate,
            vehicleVin: r.vehicleVin,
            ownerLastName: null,
          }));
      },
    );

    const norm = normalizeLookupQuery(payload);
    const matched = candidates.filter((c) => candidateMatches(c, norm));
    const result = classifyMatches(matched);

    if (result.kind === 'multi') {
      return { found: false, sessionId: null, channel: null, partialMatches: result.masked };
    }
    if (result.kind === 'none') {
      // No oracle: a no-match is indistinguishable from a not-yet-eligible one.
      return { found: false, sessionId: null, channel: null, partialMatches: [] };
    }

    // Single match → create a session + send a magic link.
    const single = result.single;
    return this.openSessionAndSendLink(tenant.id, single, ip, userAgent);
  }

  private async openSessionAndSendLink(
    tenantId: string,
    candidate: LookupCandidate,
    ip: string | null,
    userAgent: string | null,
  ): Promise<PortalLookupResult> {
    const mlRl = await this.rateLimiter.check(
      magicLinkRateKey(tenantId, candidate.impoundId),
      MAGIC_LINK_RATE_LIMIT,
      MAGIC_LINK_RATE_WINDOW_SECONDS,
    );
    if (!mlRl.allowed) {
      throw new BadRequestException({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'A link was recently sent for this vehicle — please check your phone/email',
      });
    }

    const contact = await this.resolveOwnerContact(tenantId, candidate.impoundId);
    const channel: 'sms' | 'email' | null = contact.phone ? 'sms' : contact.email ? 'email' : null;
    if (!channel) {
      // Per the DO-NOT list: never send without a channel; tell the caller.
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message:
          'No phone or email on file for this vehicle — please contact the yard directly to arrange release',
      });
    }

    const lookupToken = uuidv7();
    const magicToken = `${uuidv7()}.${uuidv7()}`;
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const sessionId = uuidv7();

    await this.tenantDb.runInTenantContext({ tenantId, userId: SYSTEM_ACTOR }, async (tx) => {
      await tx.insert(customerPortalSessions).values({
        id: sessionId,
        tenantId,
        impoundId: candidate.impoundId,
        lookupToken,
        magicLinkToken: magicToken,
        magicLinkExpiresAt: expiresAt,
        claims: {},
        ip,
        userAgent,
      });
    });

    const link = `https://${contact.tenantSlug}.${this.config.portal.baseDomain}/recover/verify?token=${magicToken}`;
    try {
      if (channel === 'sms' && contact.phone) {
        await this.notifications.sendSms({
          tenantId,
          to: contact.phone,
          body: magicLinkSms({ tenantName: contact.tenantName, link }),
          clientReference: `ssp-magic-link:${sessionId}`,
        });
      }
      // Email-fallback delivery is wired to the email transport once the
      // impound→owner-contact join lands (see SESSION_55_REPORT 🟡).
    } catch (err) {
      this.log.error({ err, sessionId }, 'magic-link send failed');
      // Don't leak delivery failure as a different shape — the link still
      // exists; the owner can retry within the per-impound limit.
    }

    return { found: true, sessionId, channel, partialMatches: [] };
  }

  /**
   * Best-effort owner-contact resolver. The S22 impound model has no direct
   * owner contact, so v1 returns nulls (no channel) until the impound→customer
   * join lands; the tenant name/slug are always available for the template.
   */
  private async resolveOwnerContact(
    tenantId: string,
    _impoundId: string,
  ): Promise<{
    phone: string | null;
    email: string | null;
    tenantName: string;
    tenantSlug: string;
  }> {
    const tenant = await this.admin.runAsAdmin({}, async (db) =>
      db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
        columns: { name: true, slug: true },
      }),
    );
    return {
      phone: null,
      email: null,
      tenantName: tenant?.name ?? 'the yard',
      tenantSlug: tenant?.slug ?? '',
    };
  }

  // ===========================================================================
  // SESSION (magic-link verify → signed cookie)
  // ===========================================================================

  async verifyMagicLink(
    rawHost: string,
    token: string,
  ): Promise<{ cookie: string; view: PortalSessionView }> {
    this.requireEnabled();
    const tenant = await this.resolveTenantByHost(rawHost);
    const nowSec = Math.floor(Date.now() / 1000);

    const session = await this.tenantDb.runInTenantContext(
      { tenantId: tenant.id, userId: SYSTEM_ACTOR },
      async (tx) => {
        const row = await tx.query.customerPortalSessions.findFirst({
          where: and(
            eq(customerPortalSessions.magicLinkToken, token),
            isNull(customerPortalSessions.deletedAt),
          ),
        });
        if (!row || !row.magicLinkExpiresAt || row.magicLinkExpiresAt.getTime() < Date.now()) {
          return null;
        }
        // One-time: consume the magic link.
        await tx
          .update(customerPortalSessions)
          .set({ magicLinkToken: null, lastSeenAt: new Date() })
          .where(eq(customerPortalSessions.id, row.id));
        return row;
      },
    );

    if (!session || !session.impoundId) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'This link is invalid or has expired',
      });
    }

    const ttlSeconds = this.config.selfServePortal.sessionTtlMinutes * 60;
    const cookie = signSessionToken(
      { sid: session.id, tid: tenant.id, iid: session.impoundId },
      this.config.selfServePortal.sessionSecret,
      nowSec,
      ttlSeconds,
    );
    const view = await this.buildSessionView(
      tenant.id,
      session.id,
      session.impoundId,
      nowSec + ttlSeconds,
    );
    return { cookie, view };
  }

  /** Verify a session cookie and return its decoded payload (or throw 401-ish). */
  authenticate(cookie: string | undefined): SessionTokenPayload {
    this.requireEnabled();
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = cookie
      ? verifySessionToken(cookie, this.config.selfServePortal.sessionSecret, nowSec)
      : null;
    if (!payload) {
      throw new NotFoundException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Your session has expired — please look up your vehicle again',
      });
    }
    return payload;
  }

  /** Re-issue a fresh sliding cookie for the authenticated session. */
  slideCookie(payload: SessionTokenPayload): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSeconds = this.config.selfServePortal.sessionTtlMinutes * 60;
    return signSessionToken(
      { sid: payload.sid, tid: payload.tid, iid: payload.iid },
      this.config.selfServePortal.sessionSecret,
      nowSec,
      ttlSeconds,
    );
  }

  async getSessionView(payload: SessionTokenPayload): Promise<PortalSessionView> {
    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSeconds = this.config.selfServePortal.sessionTtlMinutes * 60;
    return this.buildSessionView(payload.tid, payload.sid, payload.iid, nowSec + ttlSeconds);
  }

  private async buildSessionView(
    tenantId: string,
    sessionId: string,
    impoundId: string,
    expEpochSec: number,
  ): Promise<PortalSessionView> {
    return this.tenantDb.runInTenantContext(
      { tenantId, userId: SYSTEM_ACTOR },
      async (tx): Promise<PortalSessionView> => {
        const rec = await tx.query.impoundRecords.findFirst({
          where: and(eq(impoundRecords.id, impoundId), isNull(impoundRecords.deletedAt)),
        });
        if (!rec) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Vehicle not found',
          });
        }
        const yard = rec.yardId
          ? await tx.query.impoundYards.findFirst({ where: eq(impoundYards.id, rec.yardId) })
          : null;
        const idv = await tx.query.customerPortalIdVerifications.findFirst({
          where: and(
            eq(customerPortalIdVerifications.sessionId, sessionId),
            isNull(customerPortalIdVerifications.deletedAt),
          ),
        });
        return {
          sessionId,
          impoundId,
          caseNumber: rec.id,
          vehicleYear: rec.vehicleYear ?? null,
          vehicleMake: rec.vehicleMake ?? null,
          vehicleModel: rec.vehicleModel ?? null,
          vehicleColor: rec.vehicleColor ?? null,
          licensePlate: rec.licensePlate ?? null,
          licenseState: rec.licenseState ?? null,
          status: rec.status,
          yardName: yard?.name ?? null,
          idOnFile: Boolean(idv),
          expiresAt: new Date(expEpochSec * 1000).toISOString(),
        };
      },
    );
  }

  // ===========================================================================
  // ID SELF-ATTESTATION
  // ===========================================================================

  async attestId(
    payload: SessionTokenPayload,
    body: PortalIdAttestPayload,
  ): Promise<PortalIdVerificationDto> {
    this.requireEnabled();
    const encrypted = encryptIdLast4(body.idLast4, this.config.selfServePortal.idEncryptionKey);
    const id = uuidv7();
    await this.tenantDb.runInTenantContext(
      { tenantId: payload.tid, userId: SYSTEM_ACTOR },
      async (tx) => {
        await tx.insert(customerPortalIdVerifications).values({
          id,
          tenantId: payload.tid,
          sessionId: payload.sid,
          idType: body.idType,
          idLast4: encrypted,
          fullName: body.fullName,
          dob: body.dob,
          verifiedBy: 'self_attested',
          verifiedAt: new Date(),
        });
      },
    );
    return {
      id,
      idType: body.idType,
      // Only the masked tail is ever returned; the stored value is encrypted.
      idLast4: `••••${body.idLast4}`,
      fullName: body.fullName,
      verifiedBy: 'self_attested',
      verifiedAt: new Date().toISOString(),
    };
  }

  // ===========================================================================
  // BALANCE
  // ===========================================================================

  async getBalance(payload: SessionTokenPayload): Promise<PortalBalance> {
    this.requireEnabled();
    return this.tenantDb.runInTenantContext(
      { tenantId: payload.tid, userId: SYSTEM_ACTOR },
      async (tx): Promise<PortalBalance> => {
        const fees = await tx.query.impoundFees.findMany({
          where: eq(impoundFees.impoundRecordId, payload.iid),
        });
        const paid = await this.currentPaidCents(tx, payload.tid, payload.iid);
        return computeBalance({
          impoundId: payload.iid,
          fees: fees.map((f) => ({
            feeType: f.feeType,
            amountCents: Number(f.amountCents),
            deletedAt: f.deletedAt,
          })),
          paidCents: paid,
          currency: 'usd',
          asOf: new Date(),
        });
      },
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: tx type is the drizzle Tx, kept loose for the helper.
  private async currentPaidCents(tx: any, tenantId: string, impoundId: string): Promise<number> {
    const intent = await tx.query.customerPortalReleaseIntents.findFirst({
      where: and(
        eq(customerPortalReleaseIntents.tenantId, tenantId),
        eq(customerPortalReleaseIntents.impoundId, impoundId),
        isNull(customerPortalReleaseIntents.deletedAt),
      ),
      orderBy: desc(customerPortalReleaseIntents.initiatedAt),
    });
    return intent ? Number(intent.paidCents) : 0;
  }

  // ===========================================================================
  // RELEASE INTENT + PAYMENT
  // ===========================================================================

  async initiatePayment(payload: SessionTokenPayload): Promise<PortalPayInitResult> {
    this.requireEnabled();
    this.requirePaymentEnabled();

    const tenant = await this.admin.runAsAdmin({}, async (db) =>
      db.query.tenants.findFirst({ where: eq(tenants.id, payload.tid) }),
    );
    if (!tenant)
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Tenant not found' });
    if (!tenant.stripeAccountId) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'This yard is not set up to accept online payments yet',
      });
    }

    const balance = await this.getBalance(payload);
    if (balance.balanceCents <= 0) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: 'There is no balance due',
      });
    }

    // Create the PaymentIntent on the tenant's connected account. invoiceId is
    // intentionally empty — this is NOT an invoice payment; metadata.kind routes
    // the webhook to the self-serve branch (SESSION_55_DECISIONS.md D3/D13).
    const intent = await this.provider.createPaymentIntent({
      connectedAccountId: tenant.stripeAccountId,
      amountCents: balance.balanceCents,
      currency: balance.currency,
      invoiceId: '',
      tenantId: tenant.id,
      description: `Vehicle release — impound ${payload.iid}`,
      metadata: {
        tenantId: tenant.id,
        kind: 'self_serve_portal',
        sessionId: payload.sid,
        impoundId: payload.iid,
      },
    });

    const releaseIntentId = uuidv7();
    await this.tenantDb.runInTenantContext(
      { tenantId: tenant.id, userId: SYSTEM_ACTOR },
      async (tx) => {
        await tx.insert(customerPortalReleaseIntents).values({
          id: releaseIntentId,
          tenantId: tenant.id,
          sessionId: payload.sid,
          impoundId: payload.iid,
          status: 'id_provided',
          totalDueCents: balance.balanceCents,
          paidCents: 0,
          stripePaymentIntentId: intent.externalId,
        });
        await tx.insert(customerPortalPayments).values({
          id: uuidv7(),
          tenantId: tenant.id,
          sessionId: payload.sid,
          releaseIntentId,
          stripePaymentIntentId: intent.externalId,
          amountCents: intent.amountCents,
          status: 'pending',
        });
      },
    );

    return {
      releaseIntentId,
      amountCents: intent.amountCents,
      currency: intent.currency,
      clientSecret: intent.clientSecret,
      publishableKey: this.config.stripe.publicKey ?? null,
      stripeAccountId: tenant.stripeAccountId,
    };
  }

  async getReleaseIntent(payload: SessionTokenPayload): Promise<PortalReleaseIntentDto | null> {
    this.requireEnabled();
    return this.tenantDb.runInTenantContext(
      { tenantId: payload.tid, userId: SYSTEM_ACTOR },
      async (tx): Promise<PortalReleaseIntentDto | null> => {
        const r = await tx.query.customerPortalReleaseIntents.findFirst({
          where: and(
            eq(customerPortalReleaseIntents.sessionId, payload.sid),
            isNull(customerPortalReleaseIntents.deletedAt),
          ),
          orderBy: desc(customerPortalReleaseIntents.initiatedAt),
        });
        if (!r) return null;
        return {
          id: r.id,
          impoundId: r.impoundId,
          status: r.status,
          totalDueCents: Number(r.totalDueCents),
          paidCents: Number(r.paidCents),
          stripePaymentIntentId: r.stripePaymentIntentId,
          initiatedAt: r.initiatedAt.toISOString(),
          readyForGateAt: r.readyForGateAt ? r.readyForGateAt.toISOString() : null,
          gateCompletedAt: r.gateCompletedAt ? r.gateCompletedAt.toISOString() : null,
        };
      },
    );
  }

  /**
   * Webhook hook (called from PaymentsService on payment_intent.succeeded for a
   * self_serve_portal PaymentIntent). Flips paid -> ready_for_gate and marks
   * the payment succeeded. Idempotent: re-running is a no-op once ready.
   */
  async onPaymentSucceeded(tenantId: string, piId: string, amountCents: number): Promise<void> {
    await this.tenantDb.runInTenantContext({ tenantId, userId: SYSTEM_ACTOR }, async (tx) => {
      const intent = await tx.query.customerPortalReleaseIntents.findFirst({
        where: and(
          eq(customerPortalReleaseIntents.tenantId, tenantId),
          eq(customerPortalReleaseIntents.stripePaymentIntentId, piId),
          isNull(customerPortalReleaseIntents.deletedAt),
        ),
      });
      if (intent) {
        const now = new Date();
        if (intent.status === 'id_provided' || intent.status === 'initiated') {
          // paid -> ready_for_gate (validated against the shared state machine).
          if (
            canTransitionReleaseIntent(intent.status, 'paid') &&
            canTransitionReleaseIntent('paid', 'ready_for_gate')
          ) {
            await tx
              .update(customerPortalReleaseIntents)
              .set({
                status: 'ready_for_gate',
                paidCents: Number(intent.totalDueCents),
                readyForGateAt: now,
              })
              .where(eq(customerPortalReleaseIntents.id, intent.id));
          }
        }
      }
      await tx
        .update(customerPortalPayments)
        .set({ status: 'succeeded', paidAt: new Date(), amountCents })
        .where(
          and(
            eq(customerPortalPayments.tenantId, tenantId),
            eq(customerPortalPayments.stripePaymentIntentId, piId),
            isNull(customerPortalPayments.deletedAt),
          ),
        );
    });
    this.log.info({ tenantId, piId }, 'self-serve portal payment succeeded → ready_for_gate');
  }

  async onPaymentFailed(tenantId: string, piId: string, errorText: string | null): Promise<void> {
    await this.tenantDb.runInTenantContext({ tenantId, userId: SYSTEM_ACTOR }, async (tx) => {
      await tx
        .update(customerPortalPayments)
        .set({ status: 'failed', errorText })
        .where(
          and(
            eq(customerPortalPayments.tenantId, tenantId),
            eq(customerPortalPayments.stripePaymentIntentId, piId),
            isNull(customerPortalPayments.deletedAt),
          ),
        );
    });
    // Release intent stays at id_provided — the owner can retry payment.
    this.log.warn({ tenantId, piId }, 'self-serve portal payment failed; intent stays open');
  }
}
