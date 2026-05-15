/**
 * Empty state. Used everywhere a list, dashboard, or search returns zero
 * results. Pairs an icon (lucide-react), a heading, body copy, and a
 * primary call-to-action so the user always knows the next step.
 *
 * Renders as <section aria-live="polite"> so screen readers announce the
 * empty state on load and on re-render after a search that returns
 * nothing.
 */
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <section
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-divider bg-bg-surface-elevated/30 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bg-surface-elevated text-text-secondary-on-dark">
        <Icon size={32} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-text-primary-on-dark">{title}</h2>
      {description ? (
        <p className="mb-6 max-w-md text-sm text-text-secondary-on-dark">{description}</p>
      ) : null}
      {action}
    </section>
  );
}
