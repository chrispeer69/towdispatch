/**
 * Pure-function tests for the Build 5 helpers that don't need a DB.
 * - resolveDelinquencyDays (shared) — the precedence rule for the
 *   account threshold → tenant default → cash default fallback chain.
 * - readInvoiceDefaults / readTenantTimezone — defaulting + safe-parse
 *   behavior on a malformed tenants.settings blob.
 *
 * These run as part of `pnpm --filter @ustowdispatch/api test` and
 * don't require the docker stack.
 */
import { DEFAULT_TENANT_INVOICE_DEFAULTS, resolveDelinquencyDays } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { readInvoiceDefaults, readTenantTimezone } from './tenant-settings.helper.js';

describe('resolveDelinquencyDays', () => {
  it('account threshold wins when set', () => {
    expect(resolveDelinquencyDays(7, true, DEFAULT_TENANT_INVOICE_DEFAULTS)).toBe(7);
  });

  it('tenant default applies when account threshold is null AND account is present', () => {
    expect(resolveDelinquencyDays(null, true, DEFAULT_TENANT_INVOICE_DEFAULTS)).toBe(30);
  });

  it('cash default applies when account is absent', () => {
    expect(resolveDelinquencyDays(null, false, DEFAULT_TENANT_INVOICE_DEFAULTS)).toBe(7);
  });

  it('account threshold still wins for cash (operator override case)', () => {
    expect(resolveDelinquencyDays(14, false, DEFAULT_TENANT_INVOICE_DEFAULTS)).toBe(14);
  });

  it('respects a non-default tenant invoice defaults blob', () => {
    const custom = {
      ...DEFAULT_TENANT_INVOICE_DEFAULTS,
      defaultDelinquencyDays: 45,
      cashCustomerDelinquencyDays: 3,
    };
    expect(resolveDelinquencyDays(null, true, custom)).toBe(45);
    expect(resolveDelinquencyDays(null, false, custom)).toBe(3);
  });

  it('treats zero or negative account thresholds as "unset" and falls through', () => {
    expect(resolveDelinquencyDays(0, true, DEFAULT_TENANT_INVOICE_DEFAULTS)).toBe(30);
    expect(resolveDelinquencyDays(-5, true, DEFAULT_TENANT_INVOICE_DEFAULTS)).toBe(30);
  });
});

describe('readInvoiceDefaults', () => {
  it('returns full defaults when settings blob is empty', () => {
    expect(readInvoiceDefaults({})).toEqual(DEFAULT_TENANT_INVOICE_DEFAULTS);
  });

  it('returns full defaults when settings is null/undefined', () => {
    expect(readInvoiceDefaults(null)).toEqual(DEFAULT_TENANT_INVOICE_DEFAULTS);
    expect(readInvoiceDefaults(undefined)).toEqual(DEFAULT_TENANT_INVOICE_DEFAULTS);
  });

  it('merges field-by-field — unset fields stay at default', () => {
    const result = readInvoiceDefaults({
      invoiceDefaults: { defaultDelinquencyDays: 60 },
    });
    expect(result.defaultDelinquencyDays).toBe(60);
    expect(result.cashCustomerDelinquencyDays).toBe(7);
    expect(result.invoiceNumberPrefix).toBe('INV-');
  });

  it('falls back to baked defaults when the blob fails zod parse', () => {
    // Pass garbage — Zod safeParse fails, helper returns defaults.
    const result = readInvoiceDefaults({
      invoiceDefaults: { defaultDelinquencyDays: 'not-a-number' as unknown as number },
    });
    expect(result).toEqual(DEFAULT_TENANT_INVOICE_DEFAULTS);
  });
});

describe('readTenantTimezone', () => {
  it('returns America/New_York when timezone is unset', () => {
    expect(readTenantTimezone({})).toBe('America/New_York');
    expect(readTenantTimezone(null)).toBe('America/New_York');
  });

  it('accepts a valid IANA zone', () => {
    expect(readTenantTimezone({ timezone: 'America/Los_Angeles' })).toBe('America/Los_Angeles');
    expect(readTenantTimezone({ timezone: 'Europe/London' })).toBe('Europe/London');
  });

  it('rejects garbage and falls back to default', () => {
    expect(readTenantTimezone({ timezone: 'Mars/Olympus_Mons' })).toBe('America/New_York');
    expect(readTenantTimezone({ timezone: '' })).toBe('America/New_York');
    expect(readTenantTimezone({ timezone: 123 as unknown as string })).toBe('America/New_York');
  });
});
