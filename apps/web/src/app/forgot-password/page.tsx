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
          className="font-semibold text-brand-primary transition-colors hover:text-brand-primary"
        >
          ← Back to sign in
        </Link>
      }
    >
      <ForgotForm />
    </AuthShell>
  );
}
