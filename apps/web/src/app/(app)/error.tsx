'use client';

/**
 * Authenticated-shell error boundary. Next.js calls this for any thrown
 * error inside (app)/ that escapes a finer-grained boundary. We render
 * the same UI as the in-route boundary but pass Next's reset callback
 * through so users can retry without a full reload.
 */
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: Props): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app/error]', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mx-auto flex max-w-xl flex-col items-center rounded-lg border border-danger/30 bg-danger/5 px-6 py-12 text-center"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger/15 text-danger">
        <AlertTriangle size={32} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-text-primary-on-dark">
        Something went wrong.
      </h2>
      <p className="mb-6 max-w-md text-sm text-text-secondary-on-dark">
        The page hit an unexpected error. Try again — if it keeps happening, share the reference ID
        below with support.
      </p>
      {error.digest ? (
        <code className="mb-6 select-all rounded bg-bg-surface-elevated px-3 py-1 font-mono text-xs text-text-secondary-on-dark">
          ref: {error.digest}
        </code>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset} aria-label="Retry">
          <RefreshCcw size={16} aria-hidden="true" /> Try again
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated px-4 text-sm font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to dashboard
        </Link>
      </div>
    </section>
  );
}
