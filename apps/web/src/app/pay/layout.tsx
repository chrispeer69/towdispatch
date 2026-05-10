/**
 * Layout for the public /pay/[token] surface — strips the (app) chrome and
 * suppresses search-engine indexing. PCI-relevant: nothing on this route
 * tree should be cached or indexed.
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

export default function PayLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
