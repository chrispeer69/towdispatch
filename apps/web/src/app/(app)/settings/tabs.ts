/**
 * Canonical list of /settings sub-tabs. Drives both the left-rail nav
 * in settings-sidebar.tsx and the sidebar Settings link target (the
 * first tab is the default).
 *
 * Tab order is product-defined and intentional; do not reorder without
 * updating the spec in SETTINGS_DISCOVERY.md.
 */
export interface SettingsTab {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
}

export const SETTINGS_TABS = [
  {
    slug: 'company',
    label: 'Company Profile',
    description: 'Company name, slug, address, and contact info shown on invoices and PDFs.',
  },
  {
    slug: 'services',
    label: 'Services & Pricing',
    description: 'Service catalog and rate sheets used by intake quoting and invoicing.',
  },
  {
    slug: 'account-rates',
    label: 'Account Rate Cards',
    description: 'Per-account pricing overrides that win over the tenant-default rate sheet.',
  },
  {
    slug: 'tax-fees',
    label: 'Tax & Fees',
    description: 'Tenant-wide tax jurisdictions, default rates, and recurring fee line items.',
  },
  {
    slug: 'invoice-defaults',
    label: 'Invoice Defaults',
    description: 'Default terms, number prefix, payment instructions, and PDF footer text.',
  },
  {
    slug: 'dynamic-pricing',
    label: 'Dynamic Pricing',
    description:
      'Configure the five tier categories — Weather, Traffic, Calendar, Time of Day, Special Events.',
  },
  {
    slug: 'users',
    label: 'Users & Permissions',
    description: 'Invite users, assign roles, and manage MFA and account lockout.',
  },
  {
    slug: 'notifications',
    label: 'Notifications',
    description: 'Per-tenant and per-user preferences for transactional email and in-app alerts.',
  },
  {
    slug: 'driver-app',
    label: 'Driver App',
    description:
      'Daily briefing message + video shown to every driver once per day before their first job.',
  },
  {
    slug: 'api',
    label: 'API & Webhooks',
    description:
      'Issue API keys for the public REST API and register webhook endpoints for job & impound events.',
  },
  {
    slug: 'capacity',
    label: 'Capacity Signaling',
    description:
      'CADS thresholds, job weights, manual overrides, and the motor-club partners that receive your live capacity signal.',
  },
  {
    slug: 'billing',
    label: 'Billing & Subscription',
    description: 'Stripe Connect onboarding, platform margin, and SaaS subscription billing.',
  },
  {
    slug: 'branding',
    label: 'White-Label Portal',
    description:
      'Logo, colors, support contact, and custom domain for your branded customer portal.',
  },
  {
    slug: 'sso',
    // TODO(i18n): /settings tab labels are English-only today; add es/fr
    // parity when the settings surface migrates to next-intl (Session 47).
    label: 'Enterprise SSO',
    description:
      'SAML 2.0 / OIDC single sign-on connections, SCIM 2.0 provisioning tokens, and the login audit.',
  },
] as const satisfies readonly SettingsTab[];

export type SettingsTabSlug = (typeof SETTINGS_TABS)[number]['slug'];

export const DEFAULT_SETTINGS_TAB: SettingsTabSlug = 'company';

export function settingsTabHref(slug: SettingsTabSlug): string {
  return `/settings/${slug}`;
}

export function findSettingsTab(slug: SettingsTabSlug): SettingsTab {
  // Slug is a typed union of the array slugs, so the find() result is
  // guaranteed non-undefined — but TS narrowing can't prove that, so we
  // assert the array is non-empty by definition.
  const tab = SETTINGS_TABS.find((t) => t.slug === slug);
  if (!tab) throw new Error(`Unknown settings tab: ${slug}`);
  return tab;
}
