'use client';

/**
 * Shared top-bar + page frame for every authenticated /driver/* surface.
 * Sticky header with the driver name, tenant, sign-out, and an optional
 * back button. The body is constrained to a comfortable touch-first
 * width and stays readable down to 375px.
 */
import { Button } from '@/components/ui/button';
import { useDriverAuth } from '@/lib/driver/auth';
import { ChevronLeft, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

interface Props {
  title?: string;
  backHref?: string;
  children: ReactNode;
}

export function DriverShell({ title, backHref, children }: Props): JSX.Element {
  const router = useRouter();
  const { profile, logout } = useDriverAuth();
  const displayName = profile
    ? `${profile.preferredName ?? profile.firstName} ${profile.lastName}`
    : 'Driver';

  return (
    <div className="min-h-screen bg-bg-base text-text-primary-on-dark">
      <header className="sticky top-0 z-30 border-b border-divider bg-bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-3">
          <div className="flex min-w-0 items-center gap-2">
            {backHref ? (
              <Link
                href={backHref}
                aria-label="Back"
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-bg-surface-elevated"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{title ?? displayName}</p>
              <p className="truncate text-[11px] text-text-secondary-on-dark">
                {profile?.tenantName ?? '—'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            aria-label="Sign out"
            className="gap-1"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-3 pb-32 pt-4">{children}</main>
    </div>
  );
}
