/**
 * /settings/sso — Enterprise SSO admin (Session 38).
 *
 * Wired to /admin/sso/* (OWNER/ADMIN only on the API). Lists SAML/OIDC
 * connections, SCIM provisioning tokens, and the recent login audit, and
 * surfaces create/edit/enable/delete + token mint + a test-login launcher
 * via the BFF proxy at /api/sso/*. When SSO is not enabled for the tenant
 * the API answers 403 sso_disabled / sso_tenant_not_allowed, which renders
 * as an informational banner rather than a crash.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchScimTokens, fetchSsoAudit, fetchSsoConnections } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/session';
import { AlertTriangle } from 'lucide-react';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { SsoClient } from './sso-client';

const TAB = findSettingsTab('sso');

export const metadata = { title: 'Enterprise SSO — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function SsoSettingsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const [connections, tokens, audit] = await Promise.all([
    tryFetch(() => fetchSsoConnections(token)),
    tryFetch(() => fetchScimTokens(token)),
    tryFetch(() => fetchSsoAudit(token)),
  ]);

  const firstError = connections.error ?? tokens.error ?? audit.error;
  // 403 = SSO not enabled for this tenant/deployment — informational, not fatal.
  const disabled =
    firstError?.code === 'sso_disabled' || firstError?.code === 'sso_tenant_not_allowed';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {TAB.label}
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>

      {disabled ? (
        <div className="flex items-start gap-3 rounded-[14px] border border-border-subtle bg-surface-raised/40 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary-on-dark" />
          <div>
            <p className="font-semibold text-text-primary-on-dark">
              Enterprise SSO is not enabled for this workspace
            </p>
            <p className="mt-1 text-text-secondary-on-dark">
              SSO is provisioned per workspace. Contact support to enable SAML / OIDC and SCIM for
              your account.
            </p>
          </div>
        </div>
      ) : firstError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <div>
            <p className="font-semibold text-text-primary-on-dark">
              Couldn&rsquo;t load SSO settings (HTTP {firstError.status})
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{firstError.message}</p>
          </div>
        </div>
      ) : (
        <SsoClient
          initialConnections={connections.data ?? []}
          initialTokens={tokens.data ?? []}
          initialAudit={audit.data ?? []}
        />
      )}
    </div>
  );
}
