'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Single-button light/dark toggle. Tap target ≥ 44px, accessible
 * aria-label flips with state. Hydration-safe: until the client mounts
 * we render a placeholder of the same size so the layout does not
 * jump when next-themes resolves the stored preference.
 */
export function ThemeToggle({ className = '' }: { className?: string }): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const baseClasses =
    'flex h-11 w-11 items-center justify-center rounded-[8px] border border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark transition-colors hover:text-text-primary-on-dark';
  const composed = `${baseClasses} ${className}`.trim();

  if (!mounted) {
    return <span aria-hidden className={composed} />;
  }

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={composed}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
