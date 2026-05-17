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
      base: { service: 'ustowdispatch-api', env: this.config.NODE_ENV },
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
  get databaseUrl(): string {
    // If APP_USER_PASSWORD is set, derive an app_user URL from DATABASE_URL
    // by swapping credentials. This is the path used in managed-Postgres
    // deployments (Railway/Render/Fly) where the addon hands us a single
    // superuser URL; migrations use it as-is, runtime swaps in app_user so
    // RLS is enforced.
    const pw = this.config.APP_USER_PASSWORD;
    if (pw && !this.config.DATABASE_URL.includes('app_user:')) {
      try {
        const url = new URL(this.config.DATABASE_URL);
        url.username = 'app_user';
        url.password = pw;
        return url.toString();
      } catch {
        return this.config.DATABASE_URL;
      }
    }
    return this.config.DATABASE_URL;
  }
  get databaseAdminUrl(): string {
    return this.config.DATABASE_ADMIN_URL ?? this.config.DATABASE_URL;
  }
  get redisUrl(): string {
    return this.config.REDIS_URL;
  }
  get jwt(): {
    accessSecret: string;
    refreshSecret: string;
    mfaSecret: string;
    accessTtl: string;
    refreshTtl: string;
    issuer: string;
    audience: string;
  } {
    // Domain-separate the access/refresh/mfa secrets from a single JWT_SECRET
    // so an attacker who somehow obtained a refresh-token forgery oracle
    // can't trivially mint access tokens. Explicit overrides win when set.
    const base = this.config.JWT_SECRET;
    return {
      accessSecret: this.config.JWT_ACCESS_SECRET || `${base}::access`,
      refreshSecret: this.config.JWT_REFRESH_SECRET || `${base}::refresh`,
      mfaSecret: this.config.JWT_MFA_SECRET || `${base}::mfa`,
      accessTtl: this.config.JWT_ACCESS_TTL,
      refreshTtl: this.config.JWT_REFRESH_TTL,
      issuer: this.config.JWT_ISSUER,
      audience: this.config.JWT_AUDIENCE,
    };
  }
  get totpEncryptionKey(): string {
    return this.config.TOTP_ENCRYPTION_KEY;
  }
  get mfaLoginGateEnabled(): boolean {
    return this.config.MFA_LOGIN_GATE_ENABLED;
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

  get sentryDsn(): string {
    return this.config.SENTRY_DSN;
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
}
