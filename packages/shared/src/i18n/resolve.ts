/**
 * Canada Expansion (Session 47) — locale resolution.
 *
 * Priority (highest first): explicit user preference → tenant default →
 * browser Accept-Language → en-US fallback. The user's explicit choice is an
 * OVERRIDE, so it outranks the tenant default; the request header is only a
 * hint when neither is set. See SESSION_47_DECISIONS.md.
 */
import {
  DEFAULT_LOCALE,
  type SupportedLocale,
  isSupportedLocale,
  supportedLocales,
} from './locales';

export interface LocaleResolutionInput {
  /** Per-user BCP-47 override (users.locale_preference). Wins when supported. */
  userPreference?: string | null;
  /** Tenant default (tenants.default_locale). */
  tenantDefault?: string | null;
  /** Raw browser Accept-Language header value. */
  acceptLanguage?: string | null;
}

/**
 * Best-effort map an arbitrary BCP-47 tag onto a supported locale. Exact match
 * wins; otherwise the primary language subtag picks the closest supported
 * variant (any French → fr-CA, any non-US English → en-CA).
 */
export function coerceToSupportedLocale(tag: string | null | undefined): SupportedLocale | null {
  if (!tag) return null;
  const trimmed = tag.trim();
  if (isSupportedLocale(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const lang = lower.split('-')[0];
  if (lang === 'fr') return 'fr-CA';
  if (lang === 'en') return lower === 'en-us' ? 'en-US' : 'en-CA';
  return null;
}

/** Parse Accept-Language honoring q-weights; return the first supported match. */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): SupportedLocale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.split('=')[1] ?? '') : 1;
      return { tag: (tag ?? '').trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((e) => e.tag.length > 0 && e.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const match = coerceToSupportedLocale(tag);
    if (match) return match;
  }
  return null;
}

export function resolveLocale(input: LocaleResolutionInput): SupportedLocale {
  return (
    coerceToSupportedLocale(input.userPreference) ??
    coerceToSupportedLocale(input.tenantDefault) ??
    localeFromAcceptLanguage(input.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

export { supportedLocales };
