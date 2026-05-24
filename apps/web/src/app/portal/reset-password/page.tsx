import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import type { JSX } from 'react';
import { PortalResetForm } from './reset-form';

export const dynamic = 'force-dynamic';

export default async function PortalResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<JSX.Element> {
  const t = portalMessages(await getPortalLocale());
  const { token } = await searchParams;
  return <PortalResetForm t={t} token={token ?? ''} />;
}
