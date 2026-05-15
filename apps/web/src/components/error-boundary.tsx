'use client';

/**
 * Route-level error boundary. Wraps the rendered children and catches any
 * runtime error their tree throws. Renders an in-shell error UI with:
 *   - what happened (plain language, no stack)
 *   - what to do (retry button — re-renders the boundary; link home)
 *   - a reference ID so support can find the log
 *
 * Reference ID is best-effort: we read `x-request-id` from the most recent
 * fetch response stamped in document.head as <meta name="x-request-id">,
 * otherwise a fresh uuid generated here. Either way the value is logged to
 * the console so paste-into-Sentry works.
 *
 * App Router gets a wrapper variant in app/(app)/error.tsx that injects
 * this with Next's reset callback.
 */
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft, RefreshCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Override Next's reset(); falls back to a soft page reload. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
  referenceId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, referenceId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const refId = readRequestIdMeta() ?? generateLocalRef();
    this.setState({ referenceId: refId });
    // eslint-disable-next-line no-console
    console.error('[error-boundary]', { refId, message: error.message, info });
  }

  private reset = (): void => {
    this.setState({ error: null, referenceId: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const refId = this.state.referenceId;
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
          The page hit an unexpected error. Try again — if it keeps happening, share the reference
          ID below with support.
        </p>
        {refId ? (
          <code className="mb-6 select-all rounded bg-bg-surface-elevated px-3 py-1 font-mono text-xs text-text-secondary-on-dark">
            ref: {refId}
          </code>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={this.reset} aria-label="Retry">
            <RefreshCcw size={16} aria-hidden="true" /> Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to dashboard
          </Button>
        </div>
      </section>
    );
  }
}

function readRequestIdMeta(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="x-request-id"]');
  return meta?.getAttribute('content') ?? null;
}

function generateLocalRef(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}
