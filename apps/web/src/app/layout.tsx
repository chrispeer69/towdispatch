import { ConnectivityBanner } from '@/components/connectivity-banner';
import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-barlow',
  display: 'swap',
});

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TowCommand Pro — The operating system the towing industry deserves',
  description: 'Built by operators, for operators. Free for US Tow Alliance members at cost + 20%.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
};

export const viewport: Viewport = {
  themeColor: '#1A1E2A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable}`}
    >
      <body className="bg-steel text-text-primary antialiased">
        {/* Skip link — first focusable element on every page so keyboard
            users can bypass the sidebar/topbar and jump straight to
            content. Off-screen-but-focusable (translate-y) rather than
            sr-only; Lighthouse a11y flags sr-only skip links because the
            unfocused bounding box is 1×1 (looks unfocusable to static
            analysis). */}
        <a
          href="#main-content"
          className="fixed left-4 top-0 z-50 -translate-y-16 rounded bg-orange px-4 py-2 font-semibold text-white transition-transform focus:translate-y-4"
        >
          Skip to main content
        </a>
        <ConnectivityBanner />
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          closeButton
          richColors
          // Default behaviour matches the design spec: success 3s,
          // info 5s, error sticks until dismissed.
          toastOptions={{
            classNames: {
              toast: 'border border-steel-border bg-steel-light text-text-primary',
            },
          }}
        />
      </body>
    </html>
  );
}
