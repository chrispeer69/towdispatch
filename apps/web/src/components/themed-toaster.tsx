'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

/**
 * Wraps sonner's Toaster with the active next-themes mode so toasts
 * follow the light/dark theme rather than being permanently dark.
 */
export function ThemedToaster(): JSX.Element {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={(resolvedTheme as 'light' | 'dark' | undefined) ?? 'dark'}
      position="top-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'border border-steel-border bg-steel-light text-text-primary',
        },
      }}
    />
  );
}
