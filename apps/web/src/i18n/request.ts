/**
 * Canada Expansion (Session 47) — next-intl request configuration.
 *
 * We use next-intl WITHOUT i18n routing: the locale is NOT a URL segment.
 * Instead it is resolved per request from (highest priority first) the
 * NEXT_LOCALE cookie (set when a user picks a language) then the browser
 * Accept-Language header, falling back to en-US. The tenant default is applied
 * client-side via the tenant session (see lib/i18n/formatters), so operator and
 * portal surfaces share one provider without restructuring every route.
 */
import { type SupportedLocale, resolveLocale } from '@ustowdispatch/shared';
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerList = await headers();
  const locale: SupportedLocale = resolveLocale({
    userPreference: cookieStore.get('NEXT_LOCALE')?.value ?? null,
    acceptLanguage: headerList.get('accept-language'),
  });
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
