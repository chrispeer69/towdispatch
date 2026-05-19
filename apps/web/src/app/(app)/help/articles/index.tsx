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
import { TierOfferComposerArticle } from './advanced-features-composer';
import { DynamicPricingArticle } from './advanced-features-dynamic-pricing';
import { ImpoundYardArticle } from './advanced-features-impound';
import { AccountRateCardsArticle } from './advanced-features-rates';
import { UnderstandingMoatsArticle } from './advanced-features-understanding-moats';
import { ArAgingArticle } from './billing-finance-ar';
import { GeneratingInvoicesArticle } from './billing-finance-invoices';
import { CardPaymentsArticle } from './billing-finance-payments';
import { RedAlertArticle } from './billing-finance-red-alert';
import { StatementGenerationArticle } from './billing-finance-statements';
import { DriverConductArticle } from './company-policies-conduct';
import { DamageClaimArticle } from './company-policies-damage';
import { RefundPolicyArticle } from './company-policies-refund';
import { CallIntakeArticle } from './daily-operations';
import { AssigningDriversArticle } from './daily-operations-assigning';
import { LiveDispatchBoardArticle } from './daily-operations-dispatch';
import { DriverSigninAndBriefingArticle } from './daily-operations-driver-signin';
import { CapturingEvidenceArticle } from './daily-operations-evidence';
import { DriverShiftArticle } from './daily-operations-shift';
import {
  CompanyProfileArticle,
  ConnectQuickbooksArticle,
  ConnectStripeArticle,
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
  'daily-operations/live-dispatch-board': LiveDispatchBoardArticle,
  'daily-operations/assigning-drivers': AssigningDriversArticle,
  'daily-operations/driver-shift-dvir': DriverShiftArticle,
  'daily-operations/driver-signin-and-briefing': DriverSigninAndBriefingArticle,
  'daily-operations/capturing-evidence': CapturingEvidenceArticle,
  'billing-finance/generating-invoices': GeneratingInvoicesArticle,
  'billing-finance/card-payments': CardPaymentsArticle,
  'billing-finance/ar-aging-workspace': ArAgingArticle,
  'billing-finance/statement-generation': StatementGenerationArticle,
  'billing-finance/red-alert-workflow': RedAlertArticle,
  'advanced-features/understanding-moats': UnderstandingMoatsArticle,
  'advanced-features/dynamic-pricing': DynamicPricingArticle,
  'advanced-features/tier-offer-composer': TierOfferComposerArticle,
  'advanced-features/account-rate-cards': AccountRateCardsArticle,
  'advanced-features/impound-yard-operations': ImpoundYardArticle,
  'company-policies/refund-policy-template': RefundPolicyArticle,
  'company-policies/damage-claim-procedure': DamageClaimArticle,
  'company-policies/driver-conduct': DriverConductArticle,
};

export function findArticle(key: ArticleKey): (() => JSX.Element) | null {
  return ARTICLE_REGISTRY[`${key.category}/${key.slug}`] ?? null;
}
