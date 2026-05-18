/**
 * Help Center Article Content Registry
 *
 * Each entry maps a (categorySlug, documentSlug) to a React component that
 * renders the article body. The article surface page (`[category]/[slug]/page.tsx`)
 * looks up the matching component from this map and renders it inside the
 * standard prose wrapper.
 *
 * To add a new article body:
 *   1. Append to one of the per-category files (or this index map).
 *   2. Set status='live' on the matching document in registry.ts.
 *   3. Done — the article surface picks it up automatically.
 *
 * Articles deliberately use plain JSX rather than MDX because we want full
 * control over the rendered structure (callouts, tables, screenshots) and
 * the build step is simpler without an MDX pipeline.
 */
import type { JSX } from 'react';
import { CallIntakeArticle } from './daily-operations';
import {
  ConnectQuickbooksArticle,
  ConnectStripeArticle,
  CompanyProfileArticle,
  InvitingUsersArticle,
  SystemRequirementsArticle,
} from './getting-started';

export interface ArticleKey {
  category: string;
  slug: string;
}

const ARTICLE_REGISTRY: Record<string, () => JSX.Element> = {
  'getting-started/system-requirements': SystemRequirementsArticle,
  'getting-started/company-profile': CompanyProfileArticle,
  'getting-started/inviting-users': InvitingUsersArticle,
  'getting-started/connect-stripe': ConnectStripeArticle,
  'getting-started/connect-quickbooks': ConnectQuickbooksArticle,
  'daily-operations/call-intake': CallIntakeArticle,
};

export function findArticle(key: ArticleKey): (() => JSX.Element) | null {
  return ARTICLE_REGISTRY[`${key.category}/${key.slug}`] ?? null;
}
