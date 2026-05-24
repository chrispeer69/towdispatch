/**
 * Typed configuration accessor + the application's root logger.
 * Pino is configured here (rather than as a separate module) because the
 * logger needs the validated config to choose pretty-printing in dev.
 */
import { Injectable } from '@nestjs/common';
import { type Logger, pino } from 'pino';
import { type AppConfig, loadConfig } from './config.schema.js';

@Injectable()
export class ConfigService {
  readonly config: AppConfig;
  readonly logger: Logger;

  constructor() {
    this.config = loadConfig();
    this.logger = pino({
      level: this.config.LOG_LEVEL,
      // region_id / region_role on the root logger `base` tags EVERY log line
      // (root, child loggers, Sentry context) — not just the per-request
      // access log — so cross-region log aggregation can filter by origin.
      base: {
        service: 'ustowdispatch-api',
        env: this.config.NODE_ENV,
        region_id: this.config.REGION_ID,
        region_role: this.config.REGION_ROLE,
      },
      ...(this.config.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard', singleLine: false },
            },
          }
        : {}),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.passwordHash',
          '*.refreshToken',
          '*.refreshTokenHash',
          '*.totpSecret',
          '*.totpSecretEncrypted',
        ],
        censor: '[redacted]',
      },
    });
  }

  get nodeEnv(): AppConfig['NODE_ENV'] {
    return this.config.NODE_ENV;
  }
  get apiPort(): number {
    // Honor PORT (set by Railway/Render/Fly) only when API_PORT was left at
    // the default. An explicitly set API_PORT always wins.
    const explicit = process.env.API_PORT;
    if (explicit) return this.config.API_PORT;
    return this.config.PORT ?? this.config.API_PORT;
  }
  get apiHost(): string {
    return this.config.API_HOST;
  }
  get apiPublicUrl(): string {
    return this.config.API_PUBLIC_URL;
  }
  get webPublicUrl(): string {
    return this.config.WEB_PUBLIC_URL;
  }
  get corsOrigins(): string[] {
    return this.config.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  /**
   * Derive an app_user connection URL from a raw (possibly superuser) URL by
   * swapping credentials when APP_USER_PASSWORD is set. Managed-Postgres
   * deployments hand us one superuser URL; migrations use it as-is, runtime
   * swaps in app_user so RLS is enforced. No-op when already app_user.
   */
  private toAppUserUrl(raw: string): string {
    const pw = this.config.APP_USER_PASSWORD;
    if (pw && !raw.includes('app_user:')) {
      try {
        const url = new URL(raw);
        url.username = 'app_user';
        url.password = pw;
        return url.toString();
      } catch {
        return raw;
      }
    }
    return raw;
  }
  get databaseUrl(): string {
    return this.toAppUserUrl(this.config.DATABASE_URL);
  }
  /**
   * Read-replica URL (app_user-swapped). Falls back to the primary URL when
   * DATABASE_READ_URL is unset — single-region deploys read from primary,
   * unchanged. See `readReplicaConfigured` for whether a DISTINCT replica
   * exists (the only case that warrants a separate pool / replica-lag query).
   */
  get databaseReadUrl(): string {
    if (!this.config.DATABASE_READ_URL) return this.databaseUrl;
    return this.toAppUserUrl(this.config.DATABASE_READ_URL);
  }
  /** True only when a distinct read replica is configured. */
  get readReplicaConfigured(): boolean {
    return !!this.config.DATABASE_READ_URL && this.databaseReadUrl !== this.databaseUrl;
  }
  get databaseAdminUrl(): string {
    return this.config.DATABASE_ADMIN_URL ?? this.config.DATABASE_URL;
  }

  /**
   * Multi-Region (Session 44). `isPrimary` is the single predicate the write
   * guard, the read-replica router, and the health endpoints branch on. All
   * fields default to a primary US-East single-region deploy.
   */
  get region(): {
    id: AppConfig['REGION_ID'];
    role: AppConfig['REGION_ROLE'];
    isPrimary: boolean;
    /** Origin (scheme+host) of the peer region's API, or '' when unknown. */
    peerOrigin: string;
    /** Full peer URL as configured (used to probe /ready), or '' when unset. */
    peerHealthcheckUrl: string;
    replicationLagAlertSeconds: number;
  } {
    const raw = (this.config.PRIMARY_REGION_HEALTHCHECK_URL ?? '').trim();
    let peerOrigin = '';
    if (raw) {
      try {
        peerOrigin = new URL(raw).origin;
      } catch {
        peerOrigin = '';
      }
    }
    return {
      id: this.config.REGION_ID,
      role: this.config.REGION_ROLE,
      isPrimary: this.config.REGION_ROLE === 'primary',
      peerOrigin,
      peerHealthcheckUrl: raw,
      replicationLagAlertSeconds: this.config.REPLICATION_LAG_ALERT_SECONDS,
    };
  }
  get redisUrl(): string {
    return this.config.REDIS_URL;
  }
  get jwt(): {
    accessSecret: string;
    refreshSecret: string;
    mfaSecret: string;
    driverSecret: string;
    portalSecret: string;
    accessTtl: string;
    refreshTtl: string;
    driverTtl: string;
    portalTtl: string;
    issuer: string;
    audience: string;
  } {
    // Domain-separate the access/refresh/mfa/driver/portal secrets from a
    bidderSecret: string;
    accessTtl: string;
    refreshTtl: string;
    driverTtl: string;
    bidderTtl: string;
    issuer: string;
    audience: string;
  } {
    // Domain-separate the access/refresh/mfa/driver/bidder secrets from a
    // single JWT_SECRET so an attacker who somehow obtained a refresh-token
    // forgery oracle can't trivially mint access tokens. Explicit
    // overrides win when set.
    const base = this.config.JWT_SECRET;
    return {
      accessSecret: this.config.JWT_ACCESS_SECRET || `${base}::access`,
      refreshSecret: this.config.JWT_REFRESH_SECRET || `${base}::refresh`,
      mfaSecret: this.config.JWT_MFA_SECRET || `${base}::mfa`,
      driverSecret: this.config.JWT_DRIVER_SECRET || `${base}::driver`,
      portalSecret: this.config.JWT_PORTAL_SECRET || `${base}::portal`,
      accessTtl: this.config.JWT_ACCESS_TTL,
      refreshTtl: this.config.JWT_REFRESH_TTL,
      driverTtl: this.config.JWT_DRIVER_TTL,
      portalTtl: this.config.JWT_PORTAL_TTL,
      bidderSecret: this.config.JWT_BIDDER_SECRET || `${base}::bidder`,
      accessTtl: this.config.JWT_ACCESS_TTL,
      refreshTtl: this.config.JWT_REFRESH_TTL,
      driverTtl: this.config.JWT_DRIVER_TTL,
      bidderTtl: this.config.JWT_BIDDER_TTL,
      issuer: this.config.JWT_ISSUER,
      audience: this.config.JWT_AUDIENCE,
    };
  }
  /** White-Label Customer Portal (Session 32). */
  get portal(): { baseDomain: string } {
    return { baseDomain: this.config.PORTAL_BASE_DOMAIN };

  /**
   * Auction & Remarketing Marketplace (Session 33). `cronEnabled` gates the
   * lifecycle cron body so dev/CI don't mutate seed listings every tick.
   */
  get auction(): { cronEnabled: boolean } {
    return { cronEnabled: this.config.AUCTION_LIFECYCLE_CRON_ENABLED };
  }
  get totpEncryptionKey(): string {
    return this.config.TOTP_ENCRYPTION_KEY;
  }
  get mfaLoginGateEnabled(): boolean {
    return this.config.MFA_LOGIN_GATE_ENABLED;
  }
  get voiceDriverEnabled(): boolean {
    return this.config.VOICE_DRIVER_ENABLED;
  }
  get voiceDriverConfidenceMin(): number {
    return this.config.VOICE_DRIVER_CONFIDENCE_MIN;
  }
  get smtp(): {
    host: string;
    port: number;
    user: string;
    password: string;
    secure: boolean;
    from: string;
  } {
    return {
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      user: this.config.SMTP_USER,
      password: this.config.SMTP_PASSWORD,
      secure: this.config.SMTP_SECURE,
      from: this.config.SMTP_FROM,
    };
  }
  get email(): {
    sendgridApiKey: string;
    sendgridConfigured: boolean;
    from: string;
    testToken: string;
  } {
    const sendgridApiKey = this.config.SENDGRID_API_KEY;
    const from = this.config.SENDGRID_FROM || this.config.SMTP_FROM;
    return {
      sendgridApiKey,
      sendgridConfigured: !!sendgridApiKey,
      from,
      testToken: this.config.EMAIL_TEST_TOKEN,
    };
  }
  get notification(): {
    activeProviderId: 'twilio' | 'stub';
    twilioConfigured: boolean;
    twilio: { accountSid: string; authToken: string; fromPhone: string; baseUrl: string };
    smsDefaultBody: string;
    trackingLinkTtlHours: number;
  } {
    const twilioConfigured = !!(
      this.config.TWILIO_ACCOUNT_SID &&
      this.config.TWILIO_AUTH_TOKEN &&
      this.config.TWILIO_FROM_PHONE
    );
    return {
      activeProviderId: twilioConfigured ? 'twilio' : 'stub',
      twilioConfigured,
      twilio: {
        accountSid: this.config.TWILIO_ACCOUNT_SID,
        authToken: this.config.TWILIO_AUTH_TOKEN,
        fromPhone: this.config.TWILIO_FROM_PHONE,
        baseUrl: this.config.TWILIO_BASE_URL,
      },
      smsDefaultBody: this.config.TRACKING_SMS_DEFAULT_BODY,
      trackingLinkTtlHours: this.config.TRACKING_LINK_TTL_HOURS,
    };
  }

  get stripe(): {
    secretKey: string;
    publicKey: string;
    webhookSecret: string;
    configured: boolean;
  } {
    const secretKey = this.config.STRIPE_SECRET_KEY;
    const publicKey = this.config.STRIPE_PUBLIC_KEY;
    const webhookSecret = this.config.STRIPE_WEBHOOK_SECRET;
    return {
      secretKey,
      publicKey,
      webhookSecret,
      configured: !!secretKey && !!publicKey && !secretKey.includes('missing'),
    };
  }

  /**
   * Payments cutover switch. `provider` is the single env flag
   * (PAYMENTS_PROVIDER) that selects the real Stripe SDK (`live`) vs the
   * in-memory stub (`stub`, the default). See STRIPE_LIVE_CUTOVER.md.
   */
  get payments(): { provider: 'stub' | 'live' } {
    return { provider: this.config.PAYMENTS_PROVIDER };
  }

  get dynamicPricing(): {
    cronEnabled: boolean;
    noaaUserAgent: string;
    openWeatherMapApiKey: string;
  } {
    return {
      cronEnabled: this.config.DYNAMIC_PRICING_CRON_ENABLED,
      noaaUserAgent: this.config.NOAA_USER_AGENT,
      openWeatherMapApiKey: this.config.OPENWEATHERMAP_API_KEY,
    };
  }

  /**
   * Moat #3 — Tier Offer Composer (Session 4).
   *
   * `cronEnabled` gates the @Cron decorator's body in TierOfferLifecycleCron
   * so dev/CI don't tick every 5 minutes. `webhookPublicKey` is the ECDSA
   * verification key SendGrid signs each event-webhook delivery with.
   * When unset, the webhook accepts requests with a logged warning
   * (development friendliness). Production deploys MUST set the key.
   */
  get tierOffer(): { cronEnabled: boolean; webhookPublicKey: string | null } {
    const key = this.config.SENDGRID_WEBHOOK_PUBLIC_KEY?.trim() ?? '';
    return {
      cronEnabled: this.config.TIER_OFFER_CRON_ENABLED,
      webhookPublicKey: key.length > 0 ? key : null,
    };
  }

  get quickbooks(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    sandbox: boolean;
    tokenEncryptionKey: string;
    webhookVerifierToken: string;
    configured: boolean;
  } {
    const clientId = this.config.QBO_CLIENT_ID;
    const clientSecret = this.config.QBO_CLIENT_SECRET;
    const redirectUri =
      this.config.QBO_REDIRECT_URI || `${this.config.API_PUBLIC_URL}/accounting/connect/callback`;
    return {
      clientId,
      clientSecret,
      redirectUri,
      sandbox: this.config.QBO_SANDBOX,
      tokenEncryptionKey: this.config.QBO_TOKEN_ENCRYPTION_KEY,
      webhookVerifierToken: this.config.QBO_WEBHOOK_VERIFIER_TOKEN,
      configured: !!clientId && !!clientSecret,
    };
  }

  /**
   * Photo Damage Analysis (Session 42). `provider` selects the vision engine
   * (stub | anthropic | openai). `workerEnabled` gates the retry worker. The
   * `configured` flags let the module refuse to boot in a live provider mode
   * with no key (mirrors the payments cutover guard).
   */
  get damageAnalysis(): {
    provider: 'stub' | 'anthropic' | 'openai';
    workerEnabled: boolean;
    anthropic: { apiKey: string; model: string; configured: boolean };
    openai: { apiKey: string; model: string; configured: boolean };
  } {
    const anthropicKey = this.config.ANTHROPIC_API_KEY;
    const openaiKey = this.config.OPENAI_API_KEY;
    return {
      provider: this.config.DAMAGE_ANALYSIS_PROVIDER,
      workerEnabled: this.config.DAMAGE_ANALYSIS_WORKER_ENABLED,
      anthropic: {
        apiKey: anthropicKey,
        model: this.config.ANTHROPIC_VISION_MODEL,
        configured: !!anthropicKey,
      },
      openai: {
        apiKey: openaiKey,
        model: this.config.OPENAI_VISION_MODEL,
        configured: !!openaiKey,
      },
    };
  }

  get sentryDsn(): string {
    return this.config.SENTRY_DSN;
  }
  /**
   * Guarded deliberate-error endpoint (GET /_debug/boom) used by the
   * production smoke harness. `enabled` gates the route's existence; `token`
   * is the bearer secret it requires. Both must be set for the route to do
   * anything other than 404.
   */
  get smokeDebug(): { enabled: boolean; token: string } {
    return {
      enabled: this.config.SMOKE_DEBUG_ERROR_ENABLED,
      token: this.config.SMOKE_DEBUG_TOKEN,
    };
  }
  get releaseTag(): string {
    return this.config.RELEASE_TAG;
  }
  get slowQueryThresholdMs(): number {
    return this.config.SLOW_QUERY_THRESHOLD_MS;
  }
  get slowEndpointThresholdMs(): number {
    return this.config.SLOW_ENDPOINT_THRESHOLD_MS;
  }
  get compressionMinBytes(): number {
    return this.config.COMPRESSION_MIN_BYTES;
  }
  get csp(): {
    connectSrc: string[];
    scriptSrc: string[];
    imgSrc: string[];
    frameSrc: string[];
  } {
    const split = (s: string): string[] =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    return {
      connectSrc: split(this.config.CSP_CONNECT_SRC),
      scriptSrc: split(this.config.CSP_SCRIPT_SRC),
      imgSrc: split(this.config.CSP_IMG_SRC),
      frameSrc: split(this.config.CSP_FRAME_SRC),
    };
  }
  get datadog(): { apiKey: string; env: string; service: string; configured: boolean } {
    return {
      apiKey: this.config.DD_API_KEY,
      env: this.config.DD_ENV,
      service: this.config.DD_SERVICE,
      configured: !!this.config.DD_API_KEY,
    };
  }

  get rateLimits(): {
    burstTtl: number;
    burstLimit: number;
    sustainedTtl: number;
    sustainedLimit: number;
  } {
    return {
      burstTtl: this.config.RATE_LIMIT_BURST_TTL_SECONDS,
      burstLimit: this.config.RATE_LIMIT_BURST_LIMIT,
      sustainedTtl: this.config.RATE_LIMIT_SUSTAINED_TTL_SECONDS,
      sustainedLimit: this.config.RATE_LIMIT_SUSTAINED_LIMIT,
    };
  }

  get mapboxAccessToken(): string {
    return this.config.MAPBOX_ACCESS_TOKEN;
  }

  /**
   * Phase 0 hardening (Session 17). `cronEnabled` gates the daily backup-
   * freshness cron; `maxAgeHours` is the staleness threshold; `railwayApiToken`
   * authorizes reading backup metadata from Railway (empty ⇒ check fails
   * closed). See BackupVerifyCron + scripts/ops/verify-db-backup.ts.
   */
  get backupVerify(): { cronEnabled: boolean; maxAgeHours: number; railwayApiToken: string } {
    return {
      cronEnabled: this.config.BACKUP_VERIFY_CRON_ENABLED,
      maxAgeHours: this.config.BACKUP_MAX_AGE_HOURS,
      railwayApiToken: this.config.RAILWAY_API_TOKEN.trim(),
   * Public REST API + Webhooks (Session 29). `deliveryEnabled` gates the
   * webhook delivery cron body; `signingEncryptionKey` is the AES-256-GCM key
   * for endpoint signing secrets at rest; `defaultRateLimitPerMin` is stamped
   * on newly-minted API keys.
   */
  get publicApi(): {
    deliveryEnabled: boolean;
    signingEncryptionKey: string;
    defaultRateLimitPerMin: number;
  } {
    return {
      deliveryEnabled: this.config.WEBHOOK_DELIVERY_ENABLED,
      signingEncryptionKey: this.config.WEBHOOK_SIGNING_ENCRYPTION_KEY,
      defaultRateLimitPerMin: this.config.PUBLIC_API_RATE_LIMIT_PER_MIN,
    };
  }

  /**
   * Driver Experience S3 settings. `configured` is true only when both
   * bucket and region are set; otherwise the evidence module falls back
   * to LocalStubEvidenceStorageProvider so the API still boots cleanly
   * in dev without real S3 creds.
   */
  get s3Evidence(): {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
    forcePathStyle: boolean;
    configured: boolean;
  } {
    const bucket = this.config.S3_BUCKET;
    const region = this.config.S3_REGION;
    return {
      bucket,
      region,
      accessKeyId: this.config.S3_ACCESS_KEY_ID,
      secretAccessKey: this.config.S3_SECRET_ACCESS_KEY,
      endpoint: this.config.S3_ENDPOINT,
      forcePathStyle: this.config.S3_FORCE_PATH_STYLE,
      configured: !!bucket && !!region,
    };
  }
}
