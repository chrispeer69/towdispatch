/**
 * Helpers for reading/writing tenant-level Build 5 settings off
 * tenants.settings (a jsonb column). Everything lives under
 * settings.invoiceDefaults so the blob is self-namespaced and other
 * settings groups (notifications prefs, dashboard toggles, etc.) don't
 * collide.
 */
import {
  DEFAULT_TENANT_INVOICE_DEFAULTS,
  type TenantInvoiceDefaults,
  tenantInvoiceDefaultsSchema,
} from '@ustowdispatch/shared';

const SETTINGS_KEY = 'invoiceDefaults';
const TIMEZONE_KEY = 'timezone';

/**
 * Pull the resolved TenantInvoiceDefaults out of a tenants.settings blob.
 * Falls back to DEFAULT_TENANT_INVOICE_DEFAULTS field-by-field — anything
 * the operator hasn't set yet stays at its baked-in default.
 *
 * Validates via Zod so a corrupted jsonb blob (manual db edit, foreign
 * importer) can't crash the cron with a bad type — bad fields fall back.
 */
export function readInvoiceDefaults(
  settings: Record<string, unknown> | null | undefined,
): TenantInvoiceDefaults {
  const raw = (settings?.[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {};
  const parsed = tenantInvoiceDefaultsSchema.safeParse({
    defaultDelinquencyDays:
      raw.defaultDelinquencyDays ?? DEFAULT_TENANT_INVOICE_DEFAULTS.defaultDelinquencyDays,
    cashCustomerDelinquencyDays:
      raw.cashCustomerDelinquencyDays ??
      DEFAULT_TENANT_INVOICE_DEFAULTS.cashCustomerDelinquencyDays,
    defaultInvoiceTerms:
      raw.defaultInvoiceTerms ?? DEFAULT_TENANT_INVOICE_DEFAULTS.defaultInvoiceTerms,
    invoiceNumberPrefix:
      raw.invoiceNumberPrefix ?? DEFAULT_TENANT_INVOICE_DEFAULTS.invoiceNumberPrefix,
    invoiceFooterText: raw.invoiceFooterText ?? DEFAULT_TENANT_INVOICE_DEFAULTS.invoiceFooterText,
    paymentInstructionsText:
      raw.paymentInstructionsText ?? DEFAULT_TENANT_INVOICE_DEFAULTS.paymentInstructionsText,
  });
  return parsed.success ? parsed.data : DEFAULT_TENANT_INVOICE_DEFAULTS;
}

export function mergeInvoiceDefaults(
  settings: Record<string, unknown> | null | undefined,
  patch: Partial<TenantInvoiceDefaults>,
): Record<string, unknown> {
  const base = (settings ?? {}) as Record<string, unknown>;
  const current = readInvoiceDefaults(base);
  return {
    ...base,
    [SETTINGS_KEY]: { ...current, ...patch },
  };
}

/**
 * Read the tenant's IANA timezone string out of settings. Defaults to
 * America/New_York (US Tow's home base) when unset. Validated against
 * Intl.supportedValuesOf so a typo doesn't blow up the cron.
 */
export function readTenantTimezone(settings: Record<string, unknown> | null | undefined): string {
  const raw = settings?.[TIMEZONE_KEY];
  if (typeof raw === 'string' && raw.length > 0 && isValidIanaZone(raw)) return raw;
  return 'America/New_York';
}

function isValidIanaZone(tz: string): boolean {
  try {
    // Intl.DateTimeFormat throws RangeError on unknown IANA names.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
