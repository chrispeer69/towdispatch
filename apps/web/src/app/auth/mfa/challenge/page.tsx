import { AuthShell } from '@/components/auth/auth-shell';
import { Suspense } from 'react';
import { ChallengeClient } from './challenge-client';

export const metadata = {
  title: 'Two-factor — Tow Dispatch',
};

export const dynamic = 'force-dynamic';

export default function MfaChallengePage(): JSX.Element {
  return (
    <AuthShell
      title="One more step."
      subtitle="Enter the 6-digit code from your authenticator app."
    >
      <Suspense fallback={null}>
        <ChallengeClient />
      </Suspense>
    </AuthShell>
  );
}
