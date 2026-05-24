import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import { getOptionalPortalUser } from '@/lib/portal/session';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { PortalSignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

export default async function PortalSignupPage(): Promise<JSX.Element> {
  if (await getOptionalPortalUser()) redirect('/portal/dashboard');
  const t = portalMessages(await getPortalLocale());
  return <PortalSignupForm t={t} />;
}
