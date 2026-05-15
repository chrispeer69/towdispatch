/**
 * Centered card layout used by every unauthenticated auth screen
 * (signup, login, forgot, reset, verify pending, verify result).
 * The grid + radial backgrounds match the landing page so the brand carries
 * across the whole gate.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, footer, children }: AuthShellProps): JSX.Element {
  return (
    <main className="relative flex min-h-screen flex-col bg-steel">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-12rem] h-[36rem] bg-orange-glow-radial"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange shadow-orange-glow">
            <span className="font-condensed text-xs font-extrabold tracking-tight text-white">
              UTD
            </span>
          </div>
          <span className="font-condensed text-base leading-none tracking-tight">
            <span className="font-medium">
              US <span className="text-orange">Tow</span>{' '}
            </span>
            <span className="font-extrabold italic uppercase">Dispatch</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-text-secondary"
          >
            â† Home
          </Link>
        </div>
      </header>

      <section className="relative z-10 flex flex-1 items-start justify-center px-4 pb-16 pt-8 md:items-center md:pt-0">
        <div className="w-full max-w-md">
          <div className="rounded-[14px] border border-steel-border bg-steel-mid/80 p-6 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur md:p-8">
            <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight">
              {title}
            </h1>
            {subtitle ? <p className="mt-2 text-sm text-text-secondary">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? (
            <div className="mt-6 text-center text-sm text-text-secondary">{footer}</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
