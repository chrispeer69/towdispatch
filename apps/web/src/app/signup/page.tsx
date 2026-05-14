import { AuthShell } from '@/components/auth/auth-shell';
import Link from 'next/link';
import { SignupForm } from './signup-form';

export const metadata = {
  title: 'Create your US Tow DISPATCH account',
};

export default function SignupPage(): JSX.Element {
  return (
    <AuthShell
      title="Bring your towing business online."
      subtitle="Create your US Tow DISPATCH workspace in under two minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-semibold text-orange-light transition-colors hover:text-orange"
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
