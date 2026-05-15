import { AuthShell } from '@/components/auth/auth-shell';
import { Suspense } from 'react';
import { VerifyEmailRunner } from './runner';

export const metadata = { title: 'Verify email' };

export default function VerifyEmailPage(): JSX.Element {
  return (
    <AuthShell title="Confirming your email…">
      <Suspense fallback={<p className="text-sm text-text-secondary-on-dark">Working on it…</p>}>
        <VerifyEmailRunner />
      </Suspense>
    </AuthShell>
  );
}
