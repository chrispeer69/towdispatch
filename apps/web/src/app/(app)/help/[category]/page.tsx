/**
 * /help/[category] — Per-category training-documents listing.
 *
 * Lists every document in the category as a card. "Live" documents are
 * clickable and route to /help/[category]/[slug]. "Coming soon" documents
 * render as locked placeholders.
 */
import { findCategory, HELP_CENTER_CATEGORIES, type TrainingDocument } from '../registry';
import { ArrowLeft, Clock, Lock } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

export function generateStaticParams(): { category: string }[] {
  return HELP_CENTER_CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<{ title: string }> {
  const { category: categorySlug } = await params;
  const category = findCategory(categorySlug);
  return {
    title: category ? `${category.title} — Help Center — US Tow DISPATCH` : 'Help Center',
  };
}

function CardBody({ doc, isLive }: { doc: TrainingDocument; isLive: boolean }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-text-primary-on-dark">{doc.title}</h2>
          {!isLive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              <Lock className="h-2.5 w-2.5" /> Coming soon
            </span>
          ) : null}
        </div>
        <p className="text-sm text-text-secondary-on-dark">{doc.summary}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
          {doc.estimatedMinutes != null ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {doc.estimatedMinutes} min read
            </span>
          ) : null}
          <span>For: {doc.audience.join(', ')}</span>
        </div>
      </div>
    </div>
  );
}

export default async function HelpCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<JSX.Element> {
  const { category: categorySlug } = await params;
  const category = findCategory(categorySlug);
  if (!category) notFound();
  const Icon = category.icon;
  const baseClass = 'block rounded-[14px] border border-divider bg-bg-surface p-5 transition';
  const liveClass = 'hover:border-brand-primary/40 hover:bg-bg-surface-elevated/30';
  const placeholderClass = 'opacity-70';

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Link
        href="/help"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary-on-dark hover:text-brand-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Help center
      </Link>

      <header className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border border-divider bg-bg-surface text-brand-primary">
          <Icon className="h-6 w-6" />
        </span>
        <div className="space-y-2">
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            {category.title}
          </h1>
          <p className="max-w-prose text-sm text-text-secondary-on-dark">{category.blurb}</p>
        </div>
      </header>

      <section className="space-y-3">
        {category.documents.map((doc) => {
          const isLive = doc.status === 'live';
          if (isLive) {
            return (
              <Link
                key={doc.slug}
                href={`/help/${category.slug}/${doc.slug}`}
                className={`${baseClass} ${liveClass}`}
              >
                <CardBody doc={doc} isLive={isLive} />
              </Link>
            );
          }
          return (
            <div key={doc.slug} aria-disabled className={`${baseClass} ${placeholderClass}`}>
              <CardBody doc={doc} isLive={isLive} />
            </div>
          );
        })}
      </section>
    </div>
  );
}
