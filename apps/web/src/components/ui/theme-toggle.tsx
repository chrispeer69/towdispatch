'use client';

/**
 * Light / Dark / System theme toggle.
 *
 * shadcn DropdownMenu + lucide Sun/Moon icons. Three options. The visible
 * icon is whichever side is currently active (Sun in light, Moon in
 * dark); System is shown as a Laptop glyph in the menu but renders as
 * the resolved Sun/Moon at the trigger.
 *
 * Hydration safety: until next-themes has mounted, render a same-size
 * placeholder so the topbar layout doesn't jump when the stored
 * preference resolves.
 *
 * Brand: the trigger keeps the existing `border border-divider /
 * bg-bg-surface-elevated` chrome so it visually matches the other
 * topbar icon buttons. Those tokens currently anchor to the TowGrade
 * dark palette; in light mode they are remapped by the .dark / :root
 * variants declared in globals.css.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Check, Laptop, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { type JSX, useEffect, useState } from 'react';

interface Props {
  className?: string;
}

export function ThemeToggle({ className = '' }: Props): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const triggerClasses = cn(
    'flex h-11 w-11 items-center justify-center rounded-[8px] border border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark transition-colors hover:text-text-primary-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );

  if (!mounted) {
    return <span aria-hidden className={triggerClasses} />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Toggle theme"
        title="Toggle theme"
        className={triggerClasses}
      >
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(): void => setTheme('light')}>
          <Sun className="h-4 w-4" />
          <span>Light</span>
          {theme === 'light' ? <Check className="ml-auto h-4 w-4" /> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(): void => setTheme('dark')}>
          <Moon className="h-4 w-4" />
          <span>Dark</span>
          {theme === 'dark' ? <Check className="ml-auto h-4 w-4" /> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(): void => setTheme('system')}>
          <Laptop className="h-4 w-4" />
          <span>System</span>
          {theme === 'system' ? <Check className="ml-auto h-4 w-4" /> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
