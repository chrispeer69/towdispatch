/**
 * Help Center / Training Documents Registry
 *
 * Single source of truth for every category, sub-category, and document in
 * the Help Center. New documents are added by appending to the `documents`
 * array of the appropriate category. The /help index page derives its layout
 * from this registry; per-category pages and per-document pages route by
 * the slugs defined here.
 *
 * Document `status` controls whether a card renders as a clickable link or
 * as a "Coming soon" placeholder:
 *   - 'live'    → article body lives in /help/[category]/[slug]/page.tsx
 *   - 'draft'   → still being written; visible to admins only (future)
 *   - 'planned' → known to be coming; rendered with "Coming soon" pill
 *
 * The hierarchy mirrors the structure laid out in the Help Center
 * Architecture document (May 17, 2026): five top-level categories
 * organized by role and workflow.
 */

import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BookOpen,
  ClipboardList,
  CreditCard,
  Rocket,
  Shield,
  Truck,
  Wallet,
  Zap,
} from 'lucide-react';

export type DocumentStatus = 'live' | 'draft' | 'planned';

export type AudienceRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'dispatcher'
  | 'driver'
  | 'accounting'
  | 'auditor';

export interface TrainingDocument {
  /** URL slug — must be unique within its category. */
  slug: string;
  /** Plain-language title shown on cards and the article header. */
  title: string;
  /** One- or two-sentence summary used on category index cards. */
  summary: string;
  /** Roles for whom this document is most relevant; used for filtering. */
  audience: AudienceRole[];
  /** Lifecycle state controlling whether the doc is clickable or not. */
  status: DocumentStatus;
  /** Estimated reading time in minutes. */
  estimatedMinutes?: number;
  /** ISO date of last meaningful update; surfaced on the article header. */
  lastUpdatedAt?: string;
}

export interface TrainingCategory {
  slug: string;
  title: string;
  /** Used on the index page and as a category page sub-header. */
  blurb: string;
  /** Lucide icon component used in the card. */
  icon: LucideIcon;
  /** Tailwind tone keyword for the card accent color. */
  tone: 'orange' | 'blue' | 'green' | 'violet' | 'red' | 'tan';
  documents: TrainingDocument[];
}

/**
 * The full Help Center structure. Edit here to add or rearrange documents.
 */
export const HELP_CENTER_CATEGORIES: TrainingCategory[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    blurb: 'Stand up your tenant, invite users, and connect the integrations your team will rely on.',
    icon: Rocket,
    tone: 'orange',
    documents: [
      {
        slug: 'system-requirements',
        title: 'System Requirements & Browser Setup',
        summary: 'Supported browsers, recommended hardware, and how to enable location access.',
        audience: ['owner', 'admin', 'manager', 'dispatcher', 'driver'],
        status: 'live',
        estimatedMinutes: 3,
        lastUpdatedAt: '2026-05-17',
      },
      {
        slug: 'company-profile',
        title: 'Setting up your Company Profile',
        summary: 'Walks through the 17-field Company Profile and why each section matters.',
        audience: ['owner', 'admin'],
        status: 'live',
        estimatedMinutes: 6,
        lastUpdatedAt: '2026-05-17',
      },
      {
        slug: 'inviting-users',
        title: 'Inviting Users and Setting Permissions',
        summary: 'How to send an invite, choose a role, and manage role changes over time.',
        audience: ['owner', 'admin'],
        status: 'live',
        estimatedMinutes: 5,
        lastUpdatedAt: '2026-05-17',
      },
      {
        slug: 'connect-stripe',
        title: 'Connecting your Stripe Account',
        summary: 'OAuth-connect Stripe so the platform can take card payments on your behalf.',
        audience: ['owner', 'admin', 'accounting'],
        status: 'live',
        estimatedMinutes: 4,
        lastUpdatedAt: '2026-05-17',
      },
      {
        slug: 'connect-quickbooks',
        title: 'Connecting QuickBooks Online',
        summary: 'OAuth-connect QBO so closed invoices push to your QuickBooks ledger automatically.',
        audience: ['owner', 'admin', 'accounting'],
        status: 'live',
        estimatedMinutes: 6,
        lastUpdatedAt: '2026-05-17',
      },
    ],
  },
  {
    slug: 'daily-operations',
    title: 'Daily Operations',
    blurb: 'How dispatchers and drivers run a normal day — call intake, dispatch board, shifts, and field documentation.',
    icon: Truck,
    tone: 'blue',
    documents: [
      {
        slug: 'call-intake',
        title: 'The Call Intake Workflow: From Phone Call to Dispatch',
        summary: 'Capture customer + vehicle + service in under 60 seconds with the live quote box.',
        audience: ['dispatcher'],
        status: 'live',
        estimatedMinutes: 7,
        lastUpdatedAt: '2026-05-17',
      },
      {
        slug: 'live-dispatch-board',
        title: 'Managing the Live Dispatch Board',
        summary: 'Read the board, drag jobs to drivers, monitor ETAs, and respond to status changes.',
        audience: ['dispatcher', 'manager'],
        status: 'planned',
        estimatedMinutes: 8,
      },
      {
        slug: 'assigning-drivers',
        title: 'Assigning and Reassigning Drivers',
        summary: 'How driver assignments flow from /assign-jobs to the dispatch board, and how to swap.',
        audience: ['dispatcher', 'manager'],
        status: 'planned',
        estimatedMinutes: 5,
      },
      {
        slug: 'driver-shift-dvir',
        title: 'Driver Shift Check-In and DVIRs',
        summary: 'PIN sign-in, daily briefing acknowledgment, and pre-trip inspection workflow.',
        audience: ['driver', 'manager'],
        status: 'planned',
        estimatedMinutes: 6,
      },
      {
        slug: 'capturing-evidence',
        title: 'Capturing Field Evidence (Photos, Videos, Signatures)',
        summary: 'Damage walk-around video, photo capture, and customer-signature collection.',
        audience: ['driver'],
        status: 'planned',
        estimatedMinutes: 7,
      },
    ],
  },
  {
    slug: 'billing-finance',
    title: 'Billing & Finance',
    blurb: 'For accounting teams: generate invoices, take payments, manage past-due, and close the month.',
    icon: Wallet,
    tone: 'green',
    documents: [
      {
        slug: 'generating-invoices',
        title: 'Generating and Sending Invoices',
        summary: 'How invoices are generated from completed jobs and how to deliver them by email.',
        audience: ['accounting', 'admin'],
        status: 'planned',
        estimatedMinutes: 5,
      },
      {
        slug: 'card-payments',
        title: 'Processing Credit Cards in the Field vs. Office',
        summary: 'When to use Stripe Terminal in-truck vs. the back-office Stripe checkout link.',
        audience: ['accounting', 'driver'],
        status: 'planned',
        estimatedMinutes: 6,
      },
      {
        slug: 'ar-aging-workspace',
        title: 'The A/R Aging Workspace: Managing Past Due Accounts',
        summary: 'Filter, triage, and act on overdue invoices. Bulk reminders. Account-level focus.',
        audience: ['accounting'],
        status: 'planned',
        estimatedMinutes: 8,
      },
      {
        slug: 'statement-generation',
        title: 'Statement Generation and Delivery',
        summary: 'Generate PDF statements, deliver by email, and reconcile against payments.',
        audience: ['accounting'],
        status: 'planned',
        estimatedMinutes: 6,
      },
      {
        slug: 'red-alert-workflow',
        title: 'The RED ALERT Workflow: Automated Past-Due Digests',
        summary: 'How the Monday-morning past-due email digest is generated and who receives it.',
        audience: ['owner', 'admin', 'accounting'],
        status: 'planned',
        estimatedMinutes: 5,
      },
    ],
  },
  {
    slug: 'advanced-features',
    title: 'Advanced Features Powered by AI & Moats',
    blurb: 'Differentiating capabilities: Dynamic Pricing, motor-club tier offers, account rate cards, and more.',
    icon: Zap,
    tone: 'violet',
    documents: [
      {
        slug: 'dynamic-pricing',
        title: 'Dynamic Pricing: How to Configure and Activate Tiers',
        summary: 'Five tier categories, multiplicative stacking, the 3.0× cap, and the operator override flow.',
        audience: ['owner', 'admin', 'manager'],
        status: 'planned',
        estimatedMinutes: 12,
      },
      {
        slug: 'tier-offer-composer',
        title: 'The Tier Offer Composer: Negotiating with Motor Clubs',
        summary: 'Compose, send, and track event-pricing offers to your motor-club account managers.',
        audience: ['owner', 'admin'],
        status: 'planned',
        estimatedMinutes: 9,
      },
      {
        slug: 'account-rate-cards',
        title: 'Account Rate Cards: Managing Commercial Pricing',
        summary: 'Per-account base rates, per-mile rates, and how account overrides interact with default rates.',
        audience: ['owner', 'admin'],
        status: 'planned',
        estimatedMinutes: 7,
      },
      {
        slug: 'impound-yard-operations',
        title: 'Impound & Storage Yard Operations',
        summary: 'Phase 2 module: storage rate sheets, hold types, lien notice ladders, and auction prep.',
        audience: ['owner', 'admin', 'accounting'],
        status: 'planned',
        estimatedMinutes: 12,
      },
    ],
  },
  {
    slug: 'company-policies',
    title: 'Company Policies & Procedures',
    blurb: 'Editable templates you can adapt for your business: refund policy, dispute procedures, conduct standards.',
    icon: Shield,
    tone: 'tan',
    documents: [
      {
        slug: 'refund-policy-template',
        title: 'Standard Refund Policy Template',
        summary: 'A starting-point refund policy your team can edit and adopt.',
        audience: ['owner', 'admin', 'accounting'],
        status: 'planned',
        estimatedMinutes: 8,
      },
      {
        slug: 'damage-claim-procedure',
        title: 'Damage Claim Dispute Procedure',
        summary: 'Step-by-step procedure for handling damage disputes from customer or motor-club.',
        audience: ['owner', 'admin', 'manager'],
        status: 'planned',
        estimatedMinutes: 10,
      },
      {
        slug: 'driver-conduct',
        title: 'Driver Conduct & Safety Standards',
        summary: 'Editable driver conduct policy template, suitable for the daily-briefing video script.',
        audience: ['owner', 'admin', 'manager'],
        status: 'planned',
        estimatedMinutes: 8,
      },
    ],
  },
];

/**
 * Helper: find a category by slug.
 */
export function findCategory(slug: string): TrainingCategory | undefined {
  return HELP_CENTER_CATEGORIES.find((c) => c.slug === slug);
}

/**
 * Helper: find a document inside a category.
 */
export function findDocument(
  categorySlug: string,
  documentSlug: string,
): { category: TrainingCategory; document: TrainingDocument } | undefined {
  const category = findCategory(categorySlug);
  if (!category) return undefined;
  const document = category.documents.find((d) => d.slug === documentSlug);
  if (!document) return undefined;
  return { category, document };
}

/**
 * Aggregate counts used by the index page header.
 */
export function getHelpCenterStats(): {
  totalDocuments: number;
  liveDocuments: number;
  plannedDocuments: number;
} {
  let totalDocuments = 0;
  let liveDocuments = 0;
  let plannedDocuments = 0;
  for (const c of HELP_CENTER_CATEGORIES) {
    totalDocuments += c.documents.length;
    for (const d of c.documents) {
      if (d.status === 'live') liveDocuments += 1;
      else if (d.status === 'planned') plannedDocuments += 1;
    }
  }
  return { totalDocuments, liveDocuments, plannedDocuments };
}

// Reserve unused imports for future content surface (don't trip biome on them).
export const __FUTURE_ICONS__ = { AlertTriangle, BookOpen, ClipboardList, CreditCard };
