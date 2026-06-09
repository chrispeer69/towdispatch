/**
 * Strict env validation. The app refuses to start if any required key is
 * missing or malformed. Loud failure beats silent default.
 */
import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // API_PORT wins when explicitly set; otherwise fall back to PORT (Railway,
  // Fly, Render, Heroku all set this) and finally to 3001 for dev.
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
  // When set, the runtime constructs an app_user URL by swapping credentials
  // on DATABASE_URL. This lets us point DATABASE_URL at Railway's superuser
  // string (which migrations need) while runtime still connects as a
  // role that respects RLS. If absent, DATABASE_URL is used verbatim.
  APP_USER_PASSWORD: z.string().optional(),
  APP_ADMIN_PASSWORD: z.string().optional(),

  REDIS_URL: z.string().url(),

  // Single canonical JWT_SECRET (deployment-friendly). Access and refresh
  // tokens are derived by domain-separating from this one secret via HKDF-
  // style suffixing in the JWT service. Legacy JWT_ACCESS_SECRET / _REFRESH_
  // / _MFA_ env vars still work as overrides when explicitly set.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be 32+ chars'),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_MFA_SECRET: z.string().optional(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  JWT_ISSUER: z.string().default('towdispatch'),
  JWT_AUDIENCE: z.string().default('towdispatch-api'),

  // 32-byte hex/base64; used to AES-256-GCM-encrypt user TOTP secrets at rest.
  // Kept even when MFA_LOGIN_GATE_ENABLED is false — the column on `users` is
  // not dropped, so the key must still be valid to allow future re-enable.
  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(32, 'TOTP_ENCRYPTION_KEY must be 32+ chars')
    .default('change-me-totp-encryption-key-please-rotate-in-prod'),

  // Master gate for MFA on the login path. When false (default), POST
  // /auth/login never returns `mfa_required` or `mfa_setup_required` — it
  // issues tokens on a valid email+password. The /auth/mfa/* endpoints
  // remain mounted but are dormant. Flip to "true" to re-enable the wall.
  MFA_LOGIN_GATE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Legacy SMTP — kept so dev (mailhog) keeps working. Production uses
  // SendGrid; if SENDGRID_API_KEY is set the EmailService prefers it and the
  // SMTP_* values are ignored.
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_FROM: z.string().default('Tow Dispatch <no-reply@towdispatch.local>'),

  // SendGrid HTTP API. When SENDGRID_API_KEY is non-empty the EmailService
  // sends via @sendgrid/mail. SENDGRID_FROM overrides SMTP_FROM for SendGrid
  // sends; if not set, SMTP_FROM is used (must be a verified sender / on an
  // authenticated domain).
  SENDGRID_API_KEY: z.string().optional().default(''),
  SENDGRID_FROM: z.string().optional().default(''),

  // One-time bearer token for POST /admin/email/test. Required to invoke the
  // diagnostic endpoint; if empty the endpoint refuses every request.
  EMAIL_TEST_TOKEN: z.string().optional().default(''),

  // Mapbox (optional on the backend — primarily used by the web client).
  // Accepted here so Railway's env-var sync surface is consistent across
  // services and a future server-side reverse-geocoder can pick it up.
  MAPBOX_ACCESS_TOKEN: z.string().optional().default(''),

  // Per-IP and per-key rate limits. Burst is short window, sustained is long.
  RATE_LIMIT_BURST_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_BURST_LIMIT: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_SUSTAINED_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
  RATE_LIMIT_SUSTAINED_LIMIT: z.coerce.number().int().min(1).default(300),

  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),

  // Observability thresholds.
  SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().min(0).default(250),
  SLOW_ENDPOINT_THRESHOLD_MS: z.coerce.number().int().min(0).default(1000),

  // Release tag stamped on every Sentry event. Set by CI from the git SHA.
  RELEASE_TAG: z.string().optional().default('dev'),

  // Web frontend security/observability. Compression threshold in bytes.
  COMPRESSION_MIN_BYTES: z.coerce.number().int().min(0).default(1024),

  // CSP allow-list (comma-separated origins) for connect-src, script-src,
  // img-src, frame-src. Defaults cover Stripe, Mapbox, Sentry CDN; founder
  // sets these in prod env. See SESSION_17A_REPORT.md for the rationale.
  CSP_CONNECT_SRC: z
    .string()
    .default('https://api.stripe.com,https://api.mapbox.com,https://*.ingest.sentry.io'),
  CSP_SCRIPT_SRC: z.string().default('https://js.stripe.com'),
  CSP_IMG_SRC: z
    .string()
    .default('https://*.mapbox.com,https://*.tile.openstreetmap.org,data:,blob:'),
  CSP_FRAME_SRC: z.string().default('https://js.stripe.com,https://hooks.stripe.com'),

  // Datadog optional alternate to Sentry. Placeholder — actual init wires
  // up if DD_API_KEY is non-empty. Default off.
  DD_API_KEY: z.string().optional().default(''),
  DD_ENV: z.string().default('development'),
  DD_SERVICE: z.string().default('towdispatch-api'),

  // Notification provider — Twilio if creds are set, stub otherwise. The
  // config service derives `notification.activeProviderId` from these.
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM_PHONE: z.string().optional().default(''),
  TWILIO_BASE_URL: z.string().optional().default(''),

  // Default SMS body when a tenant hasn't customised one. Handlebars-style
  // {{tracking_url}} and {{tenant_name}} placeholders.
  TRACKING_SMS_DEFAULT_BODY: z
    .string()
    .default('Your tow truck is on the way. Track live: {{tracking_url}} — {{tenant_name}}'),
  TRACKING_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  // Session 11 — Stripe Connect. When STRIPE_SECRET_KEY is missing, the
  // payments module falls back to the in-memory stub provider so the API
  // boots cleanly in dev without real keys. The stub is also the test
  // default. Tests can override secrets via env in the test setup.
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_PUBLIC_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default('whsec_test_session11_default_dev_secret'),

  // Session 12 — QuickBooks Online. When QBO_CLIENT_ID is missing the stub
  // provider drives the entire accounting flow so dev can exercise the full
  // code path (OAuth, sync, webhooks, mapping) without real Intuit creds.
  QBO_CLIENT_ID: z.string().optional().default(''),
  QBO_CLIENT_SECRET: z.string().optional().default(''),
  QBO_REDIRECT_URI: z.string().optional().default(''),
  QBO_SANDBOX: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** 32+ chars; AES-256-GCM key for accounting_connections token columns. */
  QBO_TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(32, 'QBO_TOKEN_ENCRYPTION_KEY must be 32+ chars')
    .default('change-me-qbo-token-encryption-key-please-rotate-in-prod'),
  /** Intuit's "Verifier Token" for webhook signature verification. */
  QBO_WEBHOOK_VERIFIER_TOKEN: z
    .string()
    .optional()
    .default('verifier-token-session12-default-dev-value'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    process.stderr.write(`\nInvalid environment configuration:\n${issues}\n\n`);
    process.exit(1);
  }
  return parsed.data;
}
