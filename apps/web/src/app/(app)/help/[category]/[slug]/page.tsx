import { ArrowLeft, Clock } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
/**
 * /help/[category]/[slug] — Single training document article.
 *
 * Phase 1: each "live" document is hard-coded as a React component (or
 * imported MDX once we ship the MDX pipeline). For now, this page renders
 * a placeholder for any document; real content will be added document by
 * document by editing this file (or splitting it later as the registry
 * grows).
 */
import { findArticle } from '../../articles';
import { HELP_CENTER_CATEGORIES, findDocument } from '../../registry';

export function generateStaticParams(): { category: string; slug: string }[] {
  return HELP_CENTER_CATEGORIES.flatMap((c) =>
    c.documents.map((d) => ({ category: c.slug, slug: d.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<{ title: string }> {
  const { category, slug } = await params;
  const found = findDocument(category, slug);
  return {
    title: found ? `${found.document.title} — Help Center — US Tow Dispatch` : 'Help Center',
  };
}

export default async function HelpDocumentPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<JSX.Element> {
  const { category: categorySlug, slug } = await params;
  const found = findDocument(categorySlug, slug);
  if (!found) notFound();
  const { category, document } = found;

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/help/${category.slug}`}
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary-on-dark hover:text-brand-primary"
      >
        <ArrowLeft className="h-3 w-3" /> {category.title}
      </Link>

      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {document.title}
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">{document.summary}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
          {document.estimatedMinutes != null ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {document.estimatedMinutes} min read
            </span>
          ) : null}
          <span>For: {document.audience.join(', ')}</span>
          {document.lastUpdatedAt ? (
            <span>Last updated: {document.lastUpdatedAt.slice(0, 10)}</span>
          ) : null}
        </div>
      </header>

      {document.status === 'live' ? (
        (() => {
          const Article = findArticle({ category: category.slug, slug: document.slug });
          if (Article) {
            return (
              <div className="max-w-none rounded-[14px] border border-divider bg-bg-surface p-6">
                <Article />
              </div>
            );
          }
          return (
            <div className="max-w-none rounded-[14px] border border-divider bg-bg-surface p-6">
              <p className="text-sm text-text-secondary-on-dark">
                This document is marked live but its article body component has not been registered.
                Add an entry to <code>apps/web/src/app/(app)/help/articles/index.tsx</code> mapping{' '}
                <code>{`${category.slug}/${document.slug}`}</code> to the article component.
              </p>
            </div>
          );
        })()
      ) : (
        <div className="rounded-[14px] border border-dashed border-divider bg-bg-surface/50 p-6 text-center">
          <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            This guide is being written.
          </p>
          <p className="mt-2 max-w-prose text-sm text-text-secondary-on-dark">
            We're filling in the Help Center one document at a time, starting with the most-used
            workflows. Check back soon, or email{' '}
            <a
              href="mailto:support@ustowdispatch.cloud"
              className="text-brand-primary hover:underline"
            >
              support@ustowdispatch.cloud
            </a>{' '}
            if you need this document urgently.
          </p>
        </div>
      )}
    </article>
  );
}
