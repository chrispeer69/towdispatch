/**
 * shadcn-style button. Variants tuned for US Tow DISPATCH's dark steel palette:
 *   default     — solid orange CTA
 *   secondary   — steel-light surface, used for non-primary actions
 *   ghost       — transparent, used for sign-in / inline links
 *   outline     — bordered, useful on darker cards
 *   destructive — red surface for delete actions
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:pointer-events-none disabled:opacity-50 font-sans',
  {
    variants: {
      variant: {
        // Orange-dark (#C44410) on white meets WCAG AA contrast (4.5:1+);
        // the brand orange (#F05A1A) falls just short (3.19:1) which
        // Lighthouse flags. Hover lifts to the brand orange so the
        // pressed/hover state still reads as the canonical brand color.
        default: 'bg-brand-primary-hover text-white hover:bg-brand-primary',
        secondary:
          'bg-bg-surface-elevated text-text-primary-on-dark border border-divider hover:border-divider-strong',
        ghost: 'bg-transparent text-text-primary-on-dark hover:bg-bg-surface-elevated',
        outline:
          'border border-divider bg-transparent text-text-primary-on-dark hover:bg-bg-surface-elevated',
        destructive: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        // Touch-first 56px height for the driver app. Every primary
        // action in /driver/* must use this size so the hit area is
        // forgiving on a 5-inch screen in a moving truck.
        touch: 'h-14 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
});

export { buttonVariants };
