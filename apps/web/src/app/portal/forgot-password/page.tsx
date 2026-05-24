import { getPortalLocale, portalMessages } from '@/lib/portal/i18n';
import type { JSX } from 'react';
import { PortalForgotForm } from './forgot-form';

export const dynamic = 'force-dynamic';

export default async function PortalForgotPage(): Promise<JSX.Element> {
  const t = portalMessages(await getPortalLocale());
  return <PortalForgotForm t={t} />;
}
