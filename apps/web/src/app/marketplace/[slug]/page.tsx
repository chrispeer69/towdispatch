/**
 * /marketplace/[slug] — PUBLIC app detail (Session 46). Server-rendered; shows
 * the listing and the scopes the app requests so an operator can review them
 * before connecting. 404 when the slug is not a listed app.
 */
import { apiServer, tryFetch } from '@/lib/api/client';
import type { MarketplaceAppPublicDto } from '@ustowdispatch/shared';
import { MARKETPLACE_SCOPE_DESCRIPTIONS } from '@ustowdispatch/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

export const dynamic = 'force-dynamic';

export default async function MarketplaceAppPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<JSX.Element> {
  const { slug } = await params;
  const result = await tryFetch(() =>
    apiServer<MarketplaceAppPublicDto>(`/marketplace/apps/${encodeURIComponent(slug)}`, {
      accessToken: null,
    }),
  );
  if (result.error?.status === 404) notFound();
  const app = result.data;
  if (!app) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-text-secondary-on-dark">This app is currently unavailable.</p>
        <Link href="/marketplace" className="mt-4 inline-block text-accent-orange">
          ← Back to marketplace
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link href="/marketplace" className="text-sm text-accent-orange">
        ← Back to marketplace
      </Link>
      <header className="space-y-2">
        <span className="rounded-full bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-text-secondary-on-dark">
          {app.category}
        </span>
        <h1 className="font-condensed text-4xl font-extrabold uppercase tracking-tight">
          {app.name}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">by {app.developerName}</p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <p className="text-sm leading-relaxed text-text-primary-on-dark">
          {app.description || 'No description provided.'}
        </p>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-text-secondary-on-dark">
          Permissions this app requests
        </h2>
        <ul className="space-y-2">
          {app.scopes.map((scope) => (
            <li key={scope} className="flex gap-2 text-sm text-text-primary-on-dark">
              <code className="font-mono text-xs text-accent-orange">{scope}</code>
              <span className="text-text-secondary-on-dark">
                {MARKETPLACE_SCOPE_DESCRIPTIONS[scope]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-text-secondary-on-dark">
        To connect this app, start the install from the app's own site. You'll be asked to approve
        the permissions above. Manage connected apps under{' '}
        <Link href="/installed-apps" className="text-accent-orange">
          Installed apps
        </Link>
        .
      </p>
    </main>
  );
}
