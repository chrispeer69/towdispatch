/**
 * Customer portal shell (Session 32). Resolves branding from the request Host
 * and wraps every /portal/* route in the tenant's logo, colors, support
 * contact, and legal footer. When the host maps to no tenant, the whole
 * portal renders a neutral "not configured" notice instead.
 *
 * Branding colors are exposed as the CSS variables --portal-primary /
 * --portal-accent so client form components can theme buttons without
 * prop-drilling. getPortalBranding()/getPortalLocale() are request-cached, so
 * pages re-reading them cost nothing.
 */
import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import { getPortalBranding } from '@/lib/portal/session';
import type { CSSProperties, JSX, ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer Portal' };

const DEFAULT_PRIMARY = '#144399';
const DEFAULT_ACCENT = '#0EA5E9';

export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const branding = await getPortalBranding();
  const locale = await getPortalLocale();
  const t = portalMessages(locale);

  if (!branding) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
        <p className="max-w-sm text-sm text-neutral-600">{t.portalNotConfigured}</p>
      </main>
    );
  }

  const primary = branding.primaryColor ?? DEFAULT_PRIMARY;
  const accent = branding.accentColor ?? DEFAULT_ACCENT;
  const themeVars = { '--portal-primary': primary, '--portal-accent': accent } as CSSProperties;

  return (
    <div
      lang={locale}
      style={themeVars}
      className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900"
    >
      <header
        className="flex items-center gap-3 px-5 py-4 text-white shadow-sm"
        style={{ backgroundColor: primary }}
      >
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={absoluteUrl(branding.logoUrl)}
            alt={branding.tenantName}
            className="h-9 w-9 rounded object-contain"
          />
        ) : (
          <div className="grid h-9 w-9 place-items-center rounded bg-white/20 text-sm font-bold">
            {branding.tenantName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="text-base font-bold">{branding.tenantName}</span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">{children}</main>

      <footer className="border-t border-neutral-200 px-5 py-6 text-center text-xs text-neutral-500">
        <p>
          {t.needHelp}{' '}
          {branding.supportEmail ? (
            <a className="underline" href={`mailto:${branding.supportEmail}`}>
              {branding.supportEmail}
            </a>
          ) : null}
          {branding.supportPhone ? <span> · {branding.supportPhone}</span> : null}
        </p>
        <p className="mt-2 space-x-3">
          {branding.termsUrl ? (
            <a className="underline" href={branding.termsUrl}>
              Terms
            </a>
          ) : null}
          {branding.privacyUrl ? (
            <a className="underline" href={branding.privacyUrl}>
              Privacy
            </a>
          ) : null}
        </p>
        <p className="mt-2 text-neutral-400">{branding.tenantName}</p>
      </footer>
    </div>
  );
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  return `${base}${url}`;
}
