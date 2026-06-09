/**
 * Shared "repo workflow unavailable" panel for the /repo/* pages.
 *
 * The repossession module ships dark behind the API's REPO_MODULE_ENABLED
 * flag: when off, every /repo-cases and /lienholders route returns 503
 * `repo_module_disabled`. Roles the API gates out get 403. Both are expected
 * states — render a calm explainer instead of letting the 503 (a 5xx) bubble
 * to the route error boundary and blank the page.
 */
import Link from 'next/link';
import type { JSX } from 'react';

export function RepoUnavailable({
  kind,
  title = 'Repo Cases',
  backHref = '/dashboard',
  backLabel = '← Back to dashboard',
}: {
  kind: 'disabled' | 'forbidden';
  title?: string;
  backHref?: string;
  backLabel?: string;
}): JSX.Element {
  const body =
    kind === 'disabled'
      ? "The repossession module isn't enabled for your workspace yet. Contact your administrator to turn it on."
      : 'Your role does not have access to the repossession workflow. Ask an owner or admin to extend your permissions.';
  return (
    <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-text-secondary-on-dark">{body}</p>
      <p className="mt-3">
        <Link href={backHref} className="text-accent-orange">
          {backLabel}
        </Link>
      </p>
    </section>
  );
}
