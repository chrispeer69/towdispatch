/**
 * Unit coverage for the production placeholder-secret guard in
 * config.schema.ts. loadConfig() exits the process when NODE_ENV=production
 * and any at-rest encryption key / webhook verifier still carries its dev
 * default — these tests lock in the detection logic via the exported
 * findProductionPlaceholderSecrets helper (no process.exit in the test path).
 */
import { describe, expect, it } from 'vitest';
import { configSchema, findProductionPlaceholderSecrets } from './config.schema.js';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://app_user:pw@localhost:5432/ustowdispatch',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'unit-test-jwt-secret-0123456789abcdef',
};

function parseWith(overrides: Record<string, string> = {}) {
  return configSchema.parse({ ...REQUIRED_ENV, ...overrides });
}

const ROTATED = {
  TOTP_ENCRYPTION_KEY: 'rotated-totp-key-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  QBO_TOKEN_ENCRYPTION_KEY: 'rotated-qbo-key-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  QBO_WEBHOOK_VERIFIER_TOKEN: 'rotated-verifier-token-a1b2c3d4e5f6',
  WEBHOOK_SIGNING_ENCRYPTION_KEY: 'rotated-signing-key-a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'rotated-secret-key-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c',
  SSO_TOKEN_ENCRYPTION_KEY: 'rotated-sso-key-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  CUSTOMER_PORTAL_ID_ENCRYPTION_KEY: 'rotated-portal-key-a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
};

describe('findProductionPlaceholderSecrets', () => {
  it('flags every defaulted security key on a bare config', () => {
    const offenders = findProductionPlaceholderSecrets(parseWith());
    expect(offenders).toEqual([
      'TOTP_ENCRYPTION_KEY',
      'QBO_TOKEN_ENCRYPTION_KEY',
      'QBO_WEBHOOK_VERIFIER_TOKEN',
      'WEBHOOK_SIGNING_ENCRYPTION_KEY',
      'WEBHOOK_SECRET_ENCRYPTION_KEY',
      'SSO_TOKEN_ENCRYPTION_KEY',
      'CUSTOMER_PORTAL_ID_ENCRYPTION_KEY',
    ]);
  });

  it('returns empty when every key is rotated to a real value', () => {
    expect(findProductionPlaceholderSecrets(parseWith(ROTATED))).toEqual([]);
  });

  it('still flags a value that was edited but kept the change-me marker', () => {
    const offenders = findProductionPlaceholderSecrets(
      parseWith({
        ...ROTATED,
        TOTP_ENCRYPTION_KEY: 'change-me-i-appended-something-but-did-not-rotate',
      }),
    );
    expect(offenders).toEqual(['TOTP_ENCRYPTION_KEY']);
  });

  it('flags a single lingering default among otherwise-rotated keys', () => {
    const { SSO_TOKEN_ENCRYPTION_KEY: _omit, ...allButSso } = ROTATED;
    const offenders = findProductionPlaceholderSecrets(parseWith(allButSso));
    expect(offenders).toEqual(['SSO_TOKEN_ENCRYPTION_KEY']);
  });
});
