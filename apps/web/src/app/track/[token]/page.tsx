import type { TrackingPublicView } from '@towcommand/shared';
import type { Metadata } from 'next';
/**
 * Public customer tracking page — /track/[token].
 *
 * No auth, no session, no layout chrome. Server-fetches the initial view
 * via the public API, then hands off to TrackClient which keeps the page
 * live over Socket.IO.
 *
 * SEO: explicitly noindex/nofollow. These pages are PII-adjacent and must
 * not appear in any search index. The metadata export below is the
 * Next.js 15 equivalent of the <meta name="robots"> tag — both are emitted
 * for belt-and-suspenders.
 */
import type { JSX } from 'react';
import { TrackClient } from './track-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Track your service',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

const apiBase = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:3001';

async function fetchView(
  token: string,
  lang: 'en' | 'es',
): Promise<{ view: TrackingPublicView | null; expired: boolean }> {
  const url = `${apiBase()}/public/track/${encodeURIComponent(token)}?lang=${lang}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 410) return { view: null, expired: true };
  if (!res.ok) return { view: null, expired: false };
  const view = (await res.json()) as TrackingPublicView;
  return { view, expired: false };
}

export default async function TrackPage({ params, searchParams }: Props): Promise<JSX.Element> {
  const { token } = await params;
  const { lang: langParam } = await searchParams;
  const lang = langParam === 'es' ? 'es' : 'en';
  const { view, expired } = await fetchView(token, lang);

  if (expired) {
    return <ExpiredPage lang={lang} />;
  }
  if (!view) {
    return <NotFoundPage lang={lang} />;
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null;
  const usableMapbox =
    mapboxToken && !mapboxToken.startsWith('pk.placeholder') ? mapboxToken : null;

  return <TrackClient token={token} initialView={view} lang={lang} mapboxToken={usableMapbox} />;
}

function ExpiredPage({ lang }: { lang: 'en' | 'es' }): JSX.Element {
  const en = {
    title: 'This tracking link has expired',
    body: 'If your service is still in progress, contact the tow operator directly to get a fresh link.',
  };
  const es = {
    title: 'Este enlace de seguimiento ha expirado',
    body: 'Si su servicio aún está en curso, comuníquese directamente con el operador para obtener un enlace nuevo.',
  };
  const t = lang === 'es' ? es : en;
  return (
    <main className="min-h-screen bg-steel text-text-primary p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-steel-light rounded-lg p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">{t.title}</h1>
        <p className="text-text-secondary">{t.body}</p>
      </div>
    </main>
  );
}

function NotFoundPage({ lang }: { lang: 'en' | 'es' }): JSX.Element {
  const en = {
    title: 'Tracking link not found',
    body: 'The link you used appears to be invalid. Double-check the URL or contact the tow operator.',
  };
  const es = {
    title: 'Enlace de seguimiento no encontrado',
    body: 'El enlace que usó parece no ser válido. Verifique la URL o comuníquese con el operador.',
  };
  const t = lang === 'es' ? es : en;
  return (
    <main className="min-h-screen bg-steel text-text-primary p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-steel-light rounded-lg p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">{t.title}</h1>
        <p className="text-text-secondary">{t.body}</p>
      </div>
    </main>
  );
}
