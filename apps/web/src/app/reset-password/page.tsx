import { AuthShell } from '@/components/auth/auth-shell';
import { Suspense } from 'react';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Reset password' };

export default function ResetPasswordPage(): JSX.Element {
  return (
    <AuthShell title="Reset your password" subtitle="Choose a new password to sign back in.">
      <Suspense fallback={<div className="h-32" />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
