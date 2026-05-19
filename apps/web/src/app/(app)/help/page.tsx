import Link from 'next/link';
import type { JSX } from 'react';
/**
 * /help — Help Center landing.
 *
 * Renders the five top-level training-document categories defined in the
 * Help Center Architecture (May 17, 2026). Each category links to a
 * sub-page that lists every document in that category. Per-document
 * articles will fill in over the coming weeks; today most documents are
 * marked "Coming soon" and only the structure is browsable.
 *
 * The shape of this page is locked by `registry.ts`. To add a new document,
 * append to the appropriate category's `documents` array there.
 */
import { HELP_CENTER_CATEGORIES, getHelpCenterStats } from './registry';

export const metadata = { title: 'Help Center — US Tow DISPATCH' };

const TONE_ACCENT: Record<string, string> = {
  orange: 'text-brand-primary bg-brand-primary/15 border-brand-primary/20',
  blue: 'text-info bg-info/15 border-info/20',
  green: 'text-ok bg-ok/15 border-ok/20',
  violet: 'text-violet bg-violet/15 border-violet/20',
  red: 'text-danger bg-danger/15 border-danger/20',
  tan: 'text-tan bg-tan/15 border-tan/20',
};

export default function HelpCenterPage(): JSX.Element {
  const stats = getHelpCenterStats();
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Help center
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">
          Step-by-step training documents for everyone who uses US Tow DISPATCH. Choose a category
          below to see the guides available for your role. Documents marked "Coming soon" are on the
          roadmap and will be filled in over the coming weeks.
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
          {stats.liveDocuments} live · {stats.plannedDocuments} coming soon · {stats.totalDocuments}{' '}
          total
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {HELP_CENTER_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const accent = TONE_ACCENT[category.tone] ?? TONE_ACCENT.orange;
          return (
            <Link
              key={category.slug}
              href={`/help/${category.slug}`}
              className="group rounded-[14px] border border-divider bg-bg-surface p-5 transition hover:border-brand-primary/40 hover:bg-bg-surface-elevated/30"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border ${accent}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <h2 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark group-hover:text-brand-primary">
                    {category.title}
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary-on-dark">{category.blurb}</p>
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
                    {category.documents.length} documents
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      <p className="text-xs text-text-secondary-on-dark">
        Need urgent help in the meantime? Email{' '}
        <a className="text-brand-primary hover:underline" href="mailto:support@towcommand.cloud">
          support@towcommand.cloud
        </a>
        .
      </p>
    </div>
  );
}
