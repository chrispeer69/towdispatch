/**
 * /installed-apps — operator view of third-party apps connected to this
 * tenant (Session 46). Server-fetches the install roster and hands it to the
 * client list. OWNER/ADMIN only (the API gates the same way); other roles get
 * a 403 explainer, mirroring lien-cases.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import type { InstalledAppDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import type { JSX } from 'react';
import { InstalledAppsClient } from './installed-client';

export const metadata = { title: 'Installed Apps — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default async function InstalledAppsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const result = await tryFetch(() =>
    apiServer<InstalledAppDto[]>('/apps/installed', { accessToken: token ?? null }),
  );

  if (result.error?.status === 403) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="mb-2 text-2xl font-bold">Installed Apps</h1>
        <p className="text-text-secondary-on-dark">
          Your role can't manage connected apps. Ask an owner or admin to extend your permissions.
        </p>
        <p className="mt-3">
          <Link href="/dashboard" className="text-accent-orange">
            ← Back to dashboard
          </Link>
        </p>
      </section>
    );
  }

  if (result.error) {
    return (
      <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
        <h1 className="mb-2 text-2xl font-bold">Installed Apps</h1>
        <p className="text-text-secondary-on-dark">
          The marketplace is unavailable right now. Please try again later.
        </p>
      </section>
    );
  }

  return <InstalledAppsClient installs={result.data ?? []} />;
}
