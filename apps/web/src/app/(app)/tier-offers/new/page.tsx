/**
 * /tier-offers/new — operator-side composer.
 *
 * Server component pre-loads the tenant's active dynamic-pricing tiers
 * for the dropdown, then hands off to the client composer for the form
 * + recipient picker + live preview.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchTiers } from '@/lib/api/dynamic-pricing';
import { getSessionToken, requireUser } from '@/lib/auth/session';
import type { DynamicPricingTierDto } from '@ustowdispatch/shared';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ComposerClient } from './composer-client';

export const metadata = { title: 'Compose offer — Tier Offers' };
export const dynamic = 'force-dynamic';

const COMPOSER_ROLES = new Set(['owner', 'admin', 'manager']);

export default async function NewTierOfferPage(): Promise<JSX.Element> {
  const session = await requireUser();
  if (!COMPOSER_ROLES.has(session.user.role)) {
    redirect('/tier-offers');
  }
  const token = await getSessionToken();
  const tiersR = await tryFetch(() => fetchTiers(token));
  const tiers = (tiersR.data ?? []) as DynamicPricingTierDto[];
  const senderName =
    `${session.user.firstName} ${session.user.lastName}`.trim() || session.tenant.name;
  return <ComposerClient tiers={tiers} tenantName={session.tenant.name} senderName={senderName} />;
}
