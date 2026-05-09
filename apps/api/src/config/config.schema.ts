/**
 * Strict env validation. The app refuses to start if any required key is
 * missing or malformed. Loud failure beats silent default.
 */
import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be 32+ chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be 32+ chars'),
  JWT_MFA_SECRET: z
    .string()
    .min(32, 'JWT_MFA_SECRET must be 32+ chars')
    .default('change-me-mfa-challenge-secret-please-rotate-in-prod'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  JWT_ISSUER: z.string().default('towcommand'),
  JWT_AUDIENCE: z.string().default('towcommand-api'),

  // 32-byte hex/base64; used to AES-256-GCM-encrypt user TOTP secrets at rest.
  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(32, 'TOTP_ENCRYPTION_KEY must be 32+ chars')
    .default('change-me-totp-encryption-key-please-rotate-in-prod'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_FROM: z.string().default('TowCommand <no-reply@towcommand.local>'),

  // Per-IP and per-key rate limits. Burst is short window, sustained is long.
  RATE_LIMIT_BURST_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_BURST_LIMIT: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_SUSTAINED_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
  RATE_LIMIT_SUSTAINED_LIMIT: z.coerce.number().int().min(1).default(300),

  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),
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
