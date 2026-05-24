import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import { getOptionalPortalUser } from '@/lib/portal/session';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { PortalLoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function PortalLoginPage(): Promise<JSX.Element> {
  if (await getOptionalPortalUser()) redirect('/portal/dashboard');
  const t = portalMessages(await getPortalLocale());
  return <PortalLoginForm t={t} />;
}
