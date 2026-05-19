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
  const { jwt, loading, refresh } = useDriverAuth();

  // Browser bfcache (back/forward) restores the rendered DOM without
  // re-mounting React components. Without this listener, a driver who
  // signs out and then taps the back button would see the previously-
  // authenticated workspace because the page came from the cache. We
  // listen for `pageshow` with `persisted=true` (the bfcache flag),
  // re-read localStorage, and force a hard reload so the gate runs
  // against the current auth state.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted) {
        refresh();
        // After refresh setState fires, the gate effect below evaluates
        // and redirects if the JWT is gone. We don't reload here — the
        // gate handles it.
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [refresh]);

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
