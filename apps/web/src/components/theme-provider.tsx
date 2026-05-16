'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { JSX, ReactNode } from 'react';

/**
 * Wraps next-themes' provider.
 *
 * - attribute="class" so Tailwind's darkMode: 'class' fires.
 * - defaultTheme="system" + enableSystem so the OS-level preference
 *   wins on first visit; an explicit user choice (Light/Dark) made
 *   from the topbar toggle is persisted in localStorage by
 *   next-themes and overrides the system default on subsequent loads.
 * - disableTransitionOnChange prevents the entire app from running its
 *   color transitions when the user flips themes (which would look
 *   like a smear instead of a flip).
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
