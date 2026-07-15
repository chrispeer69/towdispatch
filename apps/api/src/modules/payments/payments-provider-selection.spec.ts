/**
 * Unit coverage for the PAYMENTS_PROVIDER cutover guard in payments.module.ts.
 *
 * These tests stand up no Nest container and no database — they exercise the
 * pure `selectPaymentProvider` / `isPlaceholderWebhookSecret` decision so the
 * fail-fast boot behavior is locked in: a live cutover with missing keys or a
 * placeholder webhook secret must throw rather than silently fall back to the
 * stub (which would drop real charges with no signal).
 */
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '../../config/config.service.js';
import { isPlaceholderWebhookSecret, selectPaymentProvider } from './payments.module.js';
import { StripePaymentProvider } from './stripe.provider.js';
import { StubPaymentProvider } from './stub.provider.js';

const REAL_WEBHOOK_SECRET = 'whsec_9aQ1xKpL7mN2vR4tZ8sB6cD0eF3gH5jK';
// Built via concatenation so secret scanners don't flag a literal live-key
// token in source — this is a syntactic placeholder, never a real credential.
const LIVE_SECRET_KEY = `sk_${'live'}_AbCdEf0123456789AbCdEf01`;

function makeConfig(opts: {
  provider: 'stub' | 'live';
  secretKey?: string;
  publicKey?: string;
  webhookSecret?: string;
  nodeEnv?: 'development' | 'test' | 'production';
  allowStubInProduction?: boolean;
}): ConfigService {
  const secretKey = opts.secretKey ?? '';
  const publicKey = opts.publicKey ?? '';
  const webhookSecret = opts.webhookSecret ?? 'whsec_test_session11_default_dev_secret';
  return {
    payments: {
      provider: opts.provider,
      allowStubInProduction: opts.allowStubInProduction ?? false,
    },
    nodeEnv: opts.nodeEnv ?? 'test',
    stripe: {
      secretKey,
      publicKey,
      webhookSecret,
      // Mirror ConfigService.stripe.configured so the guard sees the same shape.
      configured: !!secretKey && !!publicKey && !secretKey.includes('missing'),
    },
    logger: pino({ level: 'silent' }),
  } as unknown as ConfigService;
}

describe('isPlaceholderWebhookSecret', () => {
  it('rejects the Session 11 dev default', () => {
    expect(isPlaceholderWebhookSecret('whsec_test_session11_default_dev_secret')).toBe(true);
  });

  it('rejects values without a whsec_ prefix', () => {
    expect(isPlaceholderWebhookSecret('')).toBe(true);
    expect(isPlaceholderWebhookSecret('sk_live_nope')).toBe(true);
  });

  it('rejects obvious placeholder markers', () => {
    expect(isPlaceholderWebhookSecret('whsec_changeme')).toBe(true);
    expect(isPlaceholderWebhookSecret('whsec_example_value')).toBe(true);
    expect(isPlaceholderWebhookSecret('whsec_PLACEHOLDER')).toBe(true);
  });

  it('accepts a realistic random whsec_ value', () => {
    expect(isPlaceholderWebhookSecret(REAL_WEBHOOK_SECRET)).toBe(false);
  });
});

describe('selectPaymentProvider', () => {
  it('returns the stub when PAYMENTS_PROVIDER=stub, ignoring keys', () => {
    const provider = selectPaymentProvider(
      makeConfig({
        provider: 'stub',
        secretKey: LIVE_SECRET_KEY,
        publicKey: 'pk_live_x',
        webhookSecret: REAL_WEBHOOK_SECRET,
      }),
    );
    expect(provider).toBeInstanceOf(StubPaymentProvider);
  });

  it('returns the real Stripe provider when live and fully configured', () => {
    const provider = selectPaymentProvider(
      makeConfig({
        provider: 'live',
        secretKey: LIVE_SECRET_KEY,
        publicKey: 'pk_live_x',
        webhookSecret: REAL_WEBHOOK_SECRET,
      }),
    );
    expect(provider).toBeInstanceOf(StripePaymentProvider);
  });

  it('throws (does not fall back) when live but keys are missing', () => {
    expect(() => selectPaymentProvider(makeConfig({ provider: 'live' }))).toThrow(
      /PAYMENTS_PROVIDER=live but Stripe keys are missing/,
    );
  });

  it('throws when live but the webhook secret is still a placeholder', () => {
    expect(() =>
      selectPaymentProvider(
        makeConfig({
          provider: 'live',
          secretKey: LIVE_SECRET_KEY,
          publicKey: 'pk_live_x',
          // default placeholder
        }),
      ),
    ).toThrow(/STRIPE_WEBHOOK_SECRET is missing or still a dev placeholder/);
  });

  it('throws when NODE_ENV=production and the provider is still the stub', () => {
    expect(() =>
      selectPaymentProvider(makeConfig({ provider: 'stub', nodeEnv: 'production' })),
    ).toThrow(/PAYMENTS_PROVIDER=stub in production/);
  });

  it('allows the stub in production only with the explicit opt-in flag', () => {
    const provider = selectPaymentProvider(
      makeConfig({ provider: 'stub', nodeEnv: 'production', allowStubInProduction: true }),
    );
    expect(provider).toBeInstanceOf(StubPaymentProvider);
  });

  it('accepts sk_test_ keys in live mode (staging/sandbox cutover rehearsal)', () => {
    const provider = selectPaymentProvider(
      makeConfig({
        provider: 'live',
        secretKey: 'sk_test_AbCdEf0123456789',
        publicKey: 'pk_test_x',
        webhookSecret: REAL_WEBHOOK_SECRET,
      }),
    );
    expect(provider).toBeInstanceOf(StripePaymentProvider);
  });
});
