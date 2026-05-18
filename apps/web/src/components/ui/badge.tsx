import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-divider bg-bg-surface-elevated text-text-primary-on-dark',
        ok: 'border-ok/40 bg-ok/10 text-ok',
        warn: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        info: 'border-info/40 bg-info/10 text-info',
        brand: 'border-brand-primary/40 bg-brand-primary/10 text-brand-primary',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}
