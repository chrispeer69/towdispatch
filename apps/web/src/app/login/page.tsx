import { AuthShell } from '@/components/auth/auth-shell';
import Link from 'next/link';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Sign in to TowCommand',
};

export default function LoginPage(): JSX.Element {
  return (
    <AuthShell
      title="Welcome back."
      subtitle="Sign in to your TowCommand workspace."
      footer={
        <>
          Don&rsquo;t have an account?{' '}
          <Link
            href="/signup"
            className="font-semibold text-orange-light transition-colors hover:text-orange"
          >
            Sign up
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
