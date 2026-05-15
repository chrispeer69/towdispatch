import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark placeholder:text-text-secondary-on-dark-on-dark/60',
        'focus-visible:outline-none focus-visible:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'font-sans',
        className,
      )}
      {...props}
    />
  );
});
