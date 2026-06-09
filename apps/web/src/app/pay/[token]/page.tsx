/**
 * Public payment page — /pay/[token].
 *
 * Server-fetches the public view from the API (which creates the Stripe
 * PaymentIntent). The client component then loads Stripe.js from the CDN
 * (NOT bundled — PCI SAQ A) and renders Stripe Elements against the
 * client_secret returned by the API.
 */
import type { PublicPaymentView } from '@towdispatch/shared';
import type { Metadata } from 'next';
import type { JSX } from 'react';
import { PayClient } from './pay-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Pay invoice',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

interface Props {
  params: Promise<{ token: string }>;
}

const apiBase = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:3001';

async function fetchView(token: string): Promise<PublicPaymentView | null> {
  const url = `${apiBase()}/public/pay/${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as PublicPaymentView;
}

export default async function PayPage({ params }: Props): Promise<JSX.Element> {
  const { token } = await params;
  const view = await fetchView(token);
  if (!view) return <NotFound />;
  if (view.invoice.balanceCents <= 0) return <PaidNotice view={view} />;
  return <PayClient view={view} token={token} />;
}

function NotFound(): JSX.Element {
  return (
    <main className="min-h-screen bg-bg-base text-text-primary-on-dark p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-bg-surface-elevated rounded-lg p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Payment link not found</h1>
        <p className="text-text-secondary-on-dark">
          The link you used appears to be invalid. Double-check the URL or contact the tow operator.
        </p>
      </div>
    </main>
  );
}

function PaidNotice({ view }: { view: PublicPaymentView }): JSX.Element {
  return (
    <main className="min-h-screen bg-bg-base text-text-primary-on-dark p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-bg-surface-elevated rounded-lg p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Invoice already paid</h1>
        <p className="text-text-secondary-on-dark">
          {view.tenant.name} marked invoice {view.invoice.invoiceNumber} as paid. Nothing more to
          do.
        </p>
      </div>
    </main>
  );
}
