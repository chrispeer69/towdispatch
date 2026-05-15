/**
 * Skeleton primitives. Tuned for the dark-steel palette: a subtle gradient
 * that pulses every 1.5s so a slow-loading page never looks frozen. Tokens
 * match the rest of the design system, not Tailwind defaults.
 *
 * Compose larger skeletons by stacking these — see <SkeletonTable /> below.
 * The aria-busy attribute on the wrapper plus role="status" makes screen
 * readers announce "loading" once instead of reading every shimmer block.
 */
import { cn } from '@/lib/utils';
import type * as React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-gradient-to-r from-steel-light via-steel-border to-steel-light bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

/** A row of N table cells. Default 4 columns. */
export function SkeletonTableRow({ columns = 4 }: { columns?: number }): JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-divider px-4 py-3">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: stable count
          key={i}
          className="h-4 flex-1"
        />
      ))}
    </div>
  );
}

/** Full skeleton table with header + body. */
export function SkeletonTable({
  rows = 8,
  columns = 4,
  caption = 'Loading',
}: {
  rows?: number;
  columns?: number;
  caption?: string;
}): JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label={caption} className="overflow-hidden rounded-lg">
      <div className="flex items-center gap-4 border-b border-divider bg-bg-surface-elevated px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable count
          <Skeleton key={i} className="h-3 flex-1 bg-divider" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable count
        <SkeletonTableRow key={i} columns={columns} />
      ))}
      <span className="sr-only">{caption}</span>
    </div>
  );
}

/** Dashboard-style card skeleton. */
export function SkeletonCard({ className }: { className?: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn('rounded-lg border border-divider bg-bg-surface-elevated p-6', className)}
    >
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="mb-6 h-8 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
