import { AuthShell } from '@/components/auth/auth-shell';
import Link from 'next/link';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage(): JSX.Element {
  return (
    <AuthShell
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link
          href="/login"
          className="font-semibold text-orange-light transition-colors hover:text-orange"
        >
          ← Back to sign in
        </Link>
      }
    >
      <ForgotForm />
    </AuthShell>
  );
}
