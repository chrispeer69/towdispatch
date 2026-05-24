'use client';
import { clientUninstall } from '@/lib/api/marketplace-client';
import type { InstalledAppDto } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState, useTransition } from 'react';

interface Props {
  installs: InstalledAppDto[];
}

const formatDay = (iso: string): string => new Date(iso).toLocaleDateString();

export function InstalledAppsClient({ installs }: Props): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = installs.filter((i) => i.status === 'active');

  function uninstall(install: InstalledAppDto): void {
    if (!window.confirm(`Disconnect ${install.appName}? This revokes its access immediately.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await clientUninstall(install.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to uninstall');
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-4xl font-extrabold uppercase tracking-tight">
          Installed Apps
        </h1>
        <p className="text-sm text-text-secondary-on-dark">
          Third-party apps connected to your account. Browse more in the{' '}
          <Link href="/marketplace" className="text-accent-orange">
            marketplace
          </Link>
          .
        </p>
      </header>

      {error && (
        <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {active.length === 0 ? (
        <section className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-8 text-center">
          <p className="text-text-secondary-on-dark">No apps are connected yet.</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {active.map((install) => (
            <li
              key={install.id}
              className="flex items-center justify-between rounded-[14px] border border-divider bg-bg-surface p-4"
            >
              <div>
                <p className="font-bold text-text-primary-on-dark">{install.appName}</p>
                <p className="text-xs text-text-secondary-on-dark">
                  Connected {formatDay(install.installedAt)} · {install.scopesGranted.length}{' '}
                  permission{install.scopesGranted.length === 1 ? '' : 's'}
                </p>
                <p className="mt-1 font-mono text-[10px] text-text-secondary-on-dark">
                  {install.scopesGranted.join(' ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => uninstall(install)}
                disabled={pending}
                className="rounded-md border border-danger/50 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {pending ? 'Working…' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
