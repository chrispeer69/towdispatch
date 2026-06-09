import { AuthShell } from '@/components/auth/auth-shell';
import { Suspense } from 'react';
import { EnrollClient } from './enroll-client';

export const metadata = {
  title: 'Set up two-factor — Tow Dispatch',
};

export const dynamic = 'force-dynamic';

export default function MfaEnrollPage(): JSX.Element {
  return (
    <AuthShell
      title="Two-factor required."
      subtitle="Scan this code with your authenticator, save your recovery codes, then enter a 6-digit code to finish."
    >
      <Suspense fallback={null}>
        <EnrollClient />
      </Suspense>
    </AuthShell>
  );
}
