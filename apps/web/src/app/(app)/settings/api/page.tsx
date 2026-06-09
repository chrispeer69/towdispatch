/**
 * /settings/api — API keys & webhooks admin (OWNER/ADMIN).
 *
 * Wired to /public-api/* CRUD. The API gates every mutation to OWNER/ADMIN;
 * the client surfaces 401/403 as toasts. Initial keys + endpoints are loaded
 * server-side; a 403 (non-admin) degrades to an inline notice rather than a
 * crash, matching the /settings/users pattern.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchApiKeys, fetchWebhookEndpoints } from '@/lib/api/public-api';
import { getSessionToken } from '@/lib/auth/session';
import { AlertTriangle } from 'lucide-react';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { ApiSettingsClient } from './api-settings-client';

const TAB = findSettingsTab('api');

export const metadata = { title: 'API & Webhooks — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function ApiSettingsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const [keys, webhooks] = await Promise.all([
    tryFetch(() => fetchApiKeys(token)),
    tryFetch(() => fetchWebhookEndpoints(token)),
  ]);

  const loadError = keys.error ?? webhooks.error;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {TAB.label}
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <div>
            <p className="font-semibold text-text-primary-on-dark">
              {loadError.status === 403
                ? 'You need Owner or Admin access to manage API keys and webhooks.'
                : `Couldn't load API settings (HTTP ${loadError.status})`}
            </p>
            <p className="mt-1 text-text-secondary-on-dark">{loadError.message}</p>
          </div>
        </div>
      ) : (
        <ApiSettingsClient initialKeys={keys.data ?? []} initialWebhooks={webhooks.data ?? []} />
      )}
    </div>
  );
}
