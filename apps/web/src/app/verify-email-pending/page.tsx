import { AuthShell } from '@/components/auth/auth-shell';
import { getOptionalUser } from '@/lib/auth/session';
import Link from 'next/link';
import { Suspense } from 'react';
import { ResendVerification } from './resend';

export const metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPendingPage(): Promise<JSX.Element> {
  const me = await getOptionalUser();
  return (
    <AuthShell
      title="Check your email"
      subtitle={
        me?.user.email
          ? `We sent a verification link to ${me.user.email}.`
          : 'We sent a verification link to your inbox.'
      }
      footer={
        <Link
          href="/dashboard"
          className="font-semibold text-brand-primary transition-colors hover:text-brand-primary"
        >
          Skip for now → Dashboard
        </Link>
      }
    >
      <p className="text-sm text-text-secondary-on-dark">
        Click the link in that email to confirm your account. The link expires in 24 hours.
      </p>
      <div className="mt-6">
        <Suspense fallback={null}>
          <ResendVerification />
        </Suspense>
      </div>
    </AuthShell>
  );
}
