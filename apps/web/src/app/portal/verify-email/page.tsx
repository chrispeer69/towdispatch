import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import type { JSX } from 'react';
import { PortalVerifyClient } from './verify-client';

export const dynamic = 'force-dynamic';

export default async function PortalVerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<JSX.Element> {
  const t = portalMessages(await getPortalLocale());
  const { token } = await searchParams;
  return <PortalVerifyClient t={t} token={token ?? ''} />;
}
