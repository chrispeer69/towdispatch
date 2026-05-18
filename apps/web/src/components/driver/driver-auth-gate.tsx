'use client';

import { useDriverAuth } from '@/lib/driver/auth';
/**
 * <DriverAuthGate> — client-side route gate for /driver/*.
 *
 * Lives in apps/web/src/components/driver/ so the auth surface is
 * fully isolated from the operator app (apps/web/src/app/(app) lives in
 * a different route group with its own auth/middleware story).
 *
 * Behavior:
 *   1. On mount, read DRIVER_JWT_KEY from localStorage.
 *   2. If the current pathname is one of /driver/login, /driver/set-pin,
 *      /driver/locked — render children regardless.
 *   3. Otherwise, if no JWT, redirect to /driver/login?next=<encoded>.
 *   4. If a JWT is present on /driver/login, bounce to /driver/workspace.
 *
 * Decision logic is extracted into auth-gate-logic.ts so it can be
 * unit-tested without rendering the component.
 */
import { decideAuthGate } from '@/lib/driver/auth-gate-logic';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface Props {
  children: React.ReactNode;
}

export function DriverAuthGate({ children }: Props): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname() ?? '/driver/login';
  const { jwt, loading } = useDriverAuth();

  useEffect(() => {
    if (loading) return;
    const decision = decideAuthGate({ pathname, hasJwt: Boolean(jwt) });
    if (decision.action === 'redirect-to-login') {
      const next =
        decision.next && decision.next !== '/driver/login'
          ? `?next=${encodeURIComponent(decision.next)}`
          : '';
      router.replace(`/driver/login${next}`);
    } else if (decision.action === 'redirect-to-workspace') {
      router.replace('/driver/workspace');
    }
  }, [loading, jwt, pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-secondary-on-dark">
        <p className="text-sm">Checking your driver session…</p>
      </div>
    );
  }
  const decision = decideAuthGate({ pathname, hasJwt: Boolean(jwt) });
  if (decision.action !== 'render') {
    // Redirect is in flight — render a spinner-friendly blank.
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-secondary-on-dark">
        <p className="text-sm">Redirecting…</p>
      </div>
    );
  }
  return <>{children}</>;
}
