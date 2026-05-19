/**
 * Layout for the public /offers/[token] surface — strips the (app) chrome
 * and suppresses search-engine indexing. The route tree is unauthenticated
 * and tied to a one-time-use signed token; nothing here should be cached
 * or indexed.
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

export default function OffersLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
