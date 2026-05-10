/**
 * Layout for the public tracking surface. Strips the (app) chrome and
 * applies its own `<html lang>` from the URL — but since Next.js renders
 * a single `<html>` from the root layout, we instead set the lang on the
 * body via a className. Search-engine signals stay aggressive: noindex
 * across the entire route segment.
 */
import type { Metadata } from 'next';
import type { JSX } from 'react';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function TrackLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
