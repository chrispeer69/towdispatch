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
        'flex h-11 w-full rounded-[10px] border border-steel-border bg-steel-mid px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
        'focus-visible:outline-none focus-visible:border-orange focus-visible:ring-2 focus-visible:ring-orange/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'font-sans',
        className,
      )}
      {...props}
    />
  );
});
