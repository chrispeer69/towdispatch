/**
 * BidderAuthService — registration, email verification, and login for
 * auction bidders (Session 33).
 *
 * Bidders are an unauthenticated public surface with no operator session,
 * so every DB op runs on the admin pool with an EXPLICIT tenant_id filter
 * (the "login lookup-by-email-and-slug" seam described in
 * tenant-aware-db.service.ts). Self-service bidder rows therefore audit
 * with a NULL actor, which is correct — the actor is not a staff user.
 *
 * Credentials: argon2id password hash (reused PasswordService) + a bidder
 * JWT (audience `…-bidder`). The email-verification token lives on the
 * bidder row and is rotated on consume — no separate verification table.
 */
import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { auctionBidders, uuidv7 } from '@ustowdispatch/db';
import type {
  BidderAuthResponse,
  BidderLoginPayload,
  BidderRegisterPayload,
  BidderRegisterResponse,
} from '@ustowdispatch/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { ConfigService } from '../../../config/config.service.js';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { JwtService } from '../../auth/jwt.service.js';
import { PasswordService } from '../../auth/password.service.js';
import { EmailService } from '../../email/email.service.js';
import { AuctionService, toBidderDto } from '../auction.service.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BidderAuthService {
  private readonly log = new Logger(BidderAuthService.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly auction: AuctionService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async register(
    input: BidderRegisterPayload,
    ipAddress?: string,
  ): Promise<BidderRegisterResponse> {
    const tenantId = await this.auction.resolveTenantIdBySlug(input.tenantSlug);
    if (!tenantId)
      throw new NotFoundException({ code: 'not_found', message: 'Unknown marketplace.' });

    const email = input.email.trim();
    const passwordHash = await this.passwords.hash(input.password);
    const token = randomBytes(32).toString('base64url');
    const id = uuidv7();

    const bidder = await this.admin.runAsAdmin(
      { ...(ipAddress ? { ipAddress } : {}) },
      async (db) => {
        const existing = await db.query.auctionBidders.findFirst({
          where: and(
            eq(auctionBidders.tenantId, tenantId),
            sql`lower(${auctionBidders.email}) = ${email.toLowerCase()}`,
            isNull(auctionBidders.deletedAt),
          ),
        });
        if (existing) {
          throw new ConflictException({
            code: 'conflict',
            message: 'An account with this email already exists for this marketplace.',
          });
        }
        const [row] = await db
          .insert(auctionBidders)
          .values({
            id,
            tenantId,
            name: input.name.trim(),
            email,
            passwordHash,
            phone: input.phone ?? null,
            businessName: input.businessName ?? null,
            licenseNo: input.licenseNo ?? null,
            verificationToken: token,
            verificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
          })
          .returning();
        if (!row) throw new Error('register: insert returning() yielded no row');
        return row;
      },
    );

    const verifyUrl = this.verifyUrl(input.tenantSlug, token);
    try {
      await this.email.sendBidderVerificationEmail({
        to: bidder.email,
        name: bidder.name,
        verifyUrl,
      });
    } catch (err) {
      this.log.warn({ msg: 'bidder verification email failed', err: (err as Error).message });
    }

    // In non-production the mail seam is mailhog/none, so hand the token back
    // so the marketplace can complete verification without a live mailbox.
    const devVerificationToken = this.config.nodeEnv === 'production' ? null : token;
    return { status: 'verification_required', bidder: toBidderDto(bidder), devVerificationToken };
  }

  async verifyEmail(token: string): Promise<BidderAuthResponse> {
    const bidder = await this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.auctionBidders.findFirst({
        where: and(
          eq(auctionBidders.verificationToken, token),
          gt(auctionBidders.verificationTokenExpiresAt, new Date()),
          isNull(auctionBidders.deletedAt),
        ),
      });
      if (!row) {
        throw new UnauthorizedException({
          code: 'token_invalid',
          message: 'This verification link is invalid or has expired.',
        });
      }
      const [updated] = await db
        .update(auctionBidders)
        .set({ verifiedAt: new Date(), verificationToken: null, verificationTokenExpiresAt: null })
        .where(eq(auctionBidders.id, row.id))
        .returning();
      return updated ?? row;
    });
    return this.issueSession(bidder.id, bidder.tenantId, bidder);
  }

  async login(input: BidderLoginPayload): Promise<BidderAuthResponse> {
    const tenantId = await this.auction.resolveTenantIdBySlug(input.tenantSlug);
    if (!tenantId) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid email or password.',
      });
    }
    const email = input.email.trim().toLowerCase();
    const bidder = await this.admin.runAsAdmin({}, async (db) =>
      db.query.auctionBidders.findFirst({
        where: and(
          eq(auctionBidders.tenantId, tenantId),
          sql`lower(${auctionBidders.email}) = ${email}`,
          isNull(auctionBidders.deletedAt),
        ),
      }),
    );
    if (!bidder || !(await this.passwords.verify(bidder.passwordHash, input.password))) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid email or password.',
      });
    }
    if (bidder.blockedAt) {
      throw new ForbiddenException({ code: 'bidder_blocked', message: 'This account is blocked.' });
    }
    if (!bidder.verifiedAt) {
      throw new ForbiddenException({
        code: 'bidder_email_not_verified',
        message: 'Verify your email before signing in.',
      });
    }
    return this.issueSession(bidder.id, bidder.tenantId, bidder);
  }

  private async issueSession(
    bidderId: string,
    tenantId: string,
    bidder: Parameters<typeof toBidderDto>[0],
  ): Promise<BidderAuthResponse> {
    const accessToken = await this.jwt.signBidder({ bidderId, tid: tenantId, jti: uuidv7() });
    return {
      status: 'authenticated',
      bidder: toBidderDto(bidder),
      accessToken,
      expiresIn: this.jwt.bidderTtlSeconds(),
    };
  }

  private verifyUrl(tenantSlug: string, token: string): string {
    const base = this.config.webPublicUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ token });
    return `${base}/marketplace/${encodeURIComponent(tenantSlug)}/verify?${params.toString()}`;
  }
}
