/**
 * /developers — public developer-portal landing (Session 46).
 *
 * The developer-portal API (signup → email verify → login → app CRUD → submit
 * for review → install metrics) is complete and lives under /developers/* on
 * the API. The interactive portal UI (a separate developer-JWT auth realm in
 * the web app) is a follow-up — see SESSION_46_DECISIONS.md (🟡). This page
 * documents the API surface so partners can integrate today.
 */
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Developer Portal — US Tow Dispatch' };

const ENDPOINTS: { method: string; path: string; note: string }[] = [
  { method: 'POST', path: '/developers/signup', note: 'Register (email verification required)' },
  { method: 'POST', path: '/developers/verify-email', note: 'Confirm your email' },
  { method: 'POST', path: '/developers/login', note: 'Obtain a developer access token' },
  { method: 'POST', path: '/developers/apps', note: 'Create an app (returns client credentials)' },
  { method: 'GET', path: '/developers/apps', note: 'List your apps' },
  { method: 'POST', path: '/developers/apps/:id/submit', note: 'Submit an app for review' },
  { method: 'GET', path: '/developers/apps/:id/metrics', note: 'Install metrics' },
  { method: 'POST', path: '/oauth/authorize', note: 'Operator approves an install (PKCE)' },
  { method: 'POST', path: '/oauth/token', note: 'Exchange code / refresh for tokens' },
];

export default function DevelopersPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-4xl font-extrabold uppercase tracking-tight">
          Developer Portal
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          Build apps on US Tow Dispatch. Register an app, request granular OAuth2 scopes, and let
          operators install you from the{' '}
          <Link href="/marketplace" className="text-accent-orange">
            marketplace
          </Link>
          .
        </p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-text-secondary-on-dark">
          API surface
        </h2>
        <ul className="space-y-2">
          {ENDPOINTS.map((e) => (
            <li
              key={`${e.method} ${e.path}`}
              className="flex flex-wrap items-baseline gap-2 text-sm"
            >
              <span className="w-14 font-mono text-xs font-bold text-accent-orange">
                {e.method}
              </span>
              <code className="font-mono text-xs text-text-primary-on-dark">{e.path}</code>
              <span className="text-text-secondary-on-dark">— {e.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-text-secondary-on-dark">
        Apps use the OAuth2 authorization-code flow with PKCE (S256). Access tokens are scoped to a
        single tenant and the scopes the operator approved — never tenant-elevated. An interactive
        portal UI is coming soon.
      </p>
    </main>
  );
}
