import { AuthShell } from '@/components/auth/auth-shell';
import Link from 'next/link';
import { SignupForm } from './signup-form';

export const metadata = {
  title: 'Create your Tow Dispatch account',
};

export default function SignupPage(): JSX.Element {
  return (
    <AuthShell
      title="Bring your towing business online."
      subtitle="Create your Tow Dispatch workspace in under two minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-semibold text-brand-primary transition-colors hover:text-brand-primary"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
