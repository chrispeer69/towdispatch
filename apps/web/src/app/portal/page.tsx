import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function PortalIndex(): never {
  // Dashboard bounces to /portal/login when the visitor isn't signed in.
  redirect('/portal/dashboard');
}
