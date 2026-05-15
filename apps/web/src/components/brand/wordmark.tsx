import { cn } from '@/lib/utils';

interface WordmarkProps {
  className?: string;
  /** "lg" is for the landing hero. "sm" is for the auth pages and topbar. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClass: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-2xl',
  md: 'text-4xl',
  lg: 'text-6xl md:text-7xl',
  xl: 'text-7xl md:text-8xl',
};

export function Wordmark({ className, size = 'xl' }: WordmarkProps): JSX.Element {
  return (
    <h1 className={cn('font-condensed leading-none tracking-tight', sizeClass[size], className)}>
      <span className="font-medium">
        US <span className="text-brand-primary">Tow</span>{' '}
      </span>
      <span className="font-extrabold italic uppercase">Dispatch</span>
    </h1>
  );
}
