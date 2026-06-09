import { ConnectivityBanner } from '@/components/connectivity-banner';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemedToaster } from '@/components/themed-toaster';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'US Tow Dispatch — The operating system owned by you, built by you',
  description:
    'Owned and built by the operators, for the operators. The AI-powered operating system for every US Tow Alliance member.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
};

export const viewport: Viewport = {
  themeColor: '#1A1E2A',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Anti-flash script. Runs synchronously in <head> BEFORE React hydrates
 * so the .dark class is on <html> on the very first paint — eliminates
 * the white→dark flash users would otherwise see on dark-preferring
 * systems. Logic mirrors next-themes' own resolution order:
 *   1. localStorage 'theme' if set ('light' | 'dark' | 'system')
 *   2. prefers-color-scheme: dark
 *   3. fall back to 'dark' (matches our previous default)
 * Wrapped in try/catch because storage access throws in some private-
 * browsing modes and we must never let theme detection crash the page.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var resolved;
    if (stored === 'light' || stored === 'dark') {
      resolved = stored;
    } else if (stored === 'system' || !stored) {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`.trim();

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  // Canada Expansion (S47): resolve the request locale + messages and wrap the
  // app in the next-intl provider so every surface can translate via
  // useTranslations / getTranslations.
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: anti-flash script intentionally inlined */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            {/* Skip link — first focusable element on every page so keyboard
              users can bypass the sidebar/topbar and jump straight to
              content. Off-screen-but-focusable (translate-y) rather than
              sr-only; Lighthouse a11y flags sr-only skip links because the
              unfocused bounding box is 1×1 (looks unfocusable to static
              analysis). */}
            <a
              href="#main-content"
              className="fixed left-4 top-0 z-50 -translate-y-16 rounded bg-brand-primary px-4 py-2 font-semibold text-white transition-transform focus:translate-y-4"
            >
              Skip to main content
            </a>
            <ConnectivityBanner />
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
