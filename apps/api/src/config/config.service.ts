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
      base: { service: 'towcommand-api', env: this.config.NODE_ENV },
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
    return this.config.API_PORT;
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
    return {
      accessSecret: this.config.JWT_ACCESS_SECRET,
      refreshSecret: this.config.JWT_REFRESH_SECRET,
      mfaSecret: this.config.JWT_MFA_SECRET,
      accessTtl: this.config.JWT_ACCESS_TTL,
      refreshTtl: this.config.JWT_REFRESH_TTL,
      issuer: this.config.JWT_ISSUER,
      audience: this.config.JWT_AUDIENCE,
    };
  }
  get totpEncryptionKey(): string {
    return this.config.TOTP_ENCRYPTION_KEY;
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
