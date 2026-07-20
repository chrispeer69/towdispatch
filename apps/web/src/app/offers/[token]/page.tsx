/**
 * Public Tier Offer landing page — /offers/[token].
 *
 * The recipient (a motor-club account manager) lands here from the
 * invitation email and accepts or declines the operator's terms. The
 * token IS the auth — no login required.
 *
 * The page is server-rendered for fast first-paint and crisp deep-link
 * sharing in dispatcher group chats; the action buttons hand off to a
 * client component (offer-client.tsx) so the accept / decline POSTs
 * happen with full UA + IP capture (the API already pulls those from
 * request headers).
 */
import type { Metadata } from 'next';
import type { JSX } from 'react';
import { OfferClient } from './offer-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Tier offer',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

interface PublicOfferView {
  status: 'active' | 'already_responded' | 'cancelled' | 'expired' | 'revoked' | 'invalid';
  recipient?: {
    id: string;
    name: string;
    role: string | null;
    email: string;
    status: string;
    respondedAt: string | null;
  };
  offer?: {
    id: string;
    title: string;
    narrative: string;
    eventWindowStart: string;
    eventWindowEnd: string;
    acceptanceDeadlineAt: string;
    committedTruckCount: number;
    defaultForNonResponders: string;
    status: string;
  };
  tenant?: { id: string; name: string };
}

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}

const apiBase = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? process.env.API_PUBLIC_URL ?? 'http://localhost:3001';

async function fetchView(token: string): Promise<PublicOfferView | null> {
  const url = `${apiBase()}/public/tier-offers/${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PublicOfferView;
  } catch {
    return null;
  }
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return 'TBD';
  try {
    const d = new Date(iso);
    return d.toUTCString();
  } catch {
    return iso ?? 'TBD';
  }
}

export default async function OfferPage({ params, searchParams }: Props): Promise<JSX.Element> {
  const { token } = await params;
  const { action } = await searchParams;
  const view = await fetchView(token);
  if (!view || view.status === 'invalid')
    return (
      <ShellMessage
        title="Offer link not recognized"
        body="The link is invalid or has expired. Ask the operator to resend the offer."
      />
    );
  if (view.status === 'cancelled')
    return (
      <ShellMessage
        title="This offer has been cancelled"
        body={`${view.tenant?.name ?? 'The operator'} cancelled this offer before the event window opened. No further action is required.`}
      />
    );
  if (view.status === 'revoked')
    return (
      <ShellMessage
        title="Offer revoked"
        body="The operator revoked this invitation. Reach out to them directly if you have questions."
      />
    );
  if (view.status === 'expired')
    return (
      <ShellMessage
        title="This offer has expired"
        body="The acceptance window for this offer has closed. The operator's default-for-non-responders rule applies to your account."
      />
    );
  if (view.status === 'already_responded' && view.recipient) {
    const wasAccepted = view.recipient.status === 'accepted';
    return (
      <ShellMessage
        title={wasAccepted ? 'You accepted these terms' : 'You declined these terms'}
        body={`Recorded on ${fmt(view.recipient.respondedAt)} (UTC). The acceptance ledger is the contractual record for this engagement.`}
      />
    );
  }
  if (!view.offer || !view.recipient || !view.tenant) {
    return (
      <ShellMessage
        title="Offer not available"
        body="The offer is not available right now. Please retry later."
      />
    );
  }
  const initialAction =
    action === 'accept' || action === 'decline' ? (action as 'accept' | 'decline') : null;
  return (
    <OfferShell tenantName={view.tenant.name}>
      <article className="bg-bg-surface-elevated rounded-lg p-6 md:p-8 max-w-2xl mx-auto">
        <p className="uppercase tracking-[0.18em] text-[11px] text-text-secondary-on-dark mb-2">
          Capacity offer - {view.tenant.name}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold leading-tight mb-2">{view.offer.title}</h1>
        <p className="text-text-secondary-on-dark mb-4">
          For{' '}
          <strong>
            {view.recipient.name}
            {view.recipient.role ? `, ${view.recipient.role}` : ''}
          </strong>{' '}
          at {view.recipient.email}.
        </p>
        <div className="whitespace-pre-line text-text-primary-on-dark mb-6">
          {view.offer.narrative}
        </div>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-bg-base/40 rounded-md p-4 border border-border-on-dark">
          <div>
            <dt className="uppercase text-[10px] tracking-wide text-text-secondary-on-dark">
              Trucks committed
            </dt>
            <dd className="text-lg font-bold">{view.offer.committedTruckCount}</dd>
          </div>
          <div>
            <dt className="uppercase text-[10px] tracking-wide text-text-secondary-on-dark">
              Window
            </dt>
            <dd>
              {fmt(view.offer.eventWindowStart)} → {fmt(view.offer.eventWindowEnd)}
            </dd>
          </div>
          <div>
            <dt className="uppercase text-[10px] tracking-wide text-text-secondary-on-dark">
              Reply by
            </dt>
            <dd>{fmt(view.offer.acceptanceDeadlineAt)}</dd>
          </div>
          <div>
            <dt className="uppercase text-[10px] tracking-wide text-text-secondary-on-dark">
              If you don&apos;t reply
            </dt>
            <dd>
              {view.offer.defaultForNonResponders === 'opt_out'
                ? 'No premium dispatches accepted'
                : 'Dispatches continue at the standard rate'}
            </dd>
          </div>
        </dl>
        <OfferClient
          token={token}
          recipientName={view.recipient.name}
          initialAction={initialAction}
        />
        <p className="text-xs text-text-secondary-on-dark mt-6">
          Your IP and timestamp are logged when you click Accept or Decline. The acceptance ledger
          is the contractual record for this engagement.
        </p>
      </article>
    </OfferShell>
  );
}

function OfferShell({
  children,
  tenantName,
}: { children: React.ReactNode; tenantName: string }): JSX.Element {
  return (
    <main className="min-h-screen bg-bg-base text-text-primary-on-dark p-6 py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <p className="uppercase tracking-[0.18em] text-[11px] text-text-secondary-on-dark">
            Tow<span className="text-accent-orange">Command</span> - From {tenantName}
          </p>
        </header>
        {children}
      </div>
    </main>
  );
}

function ShellMessage({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <main className="min-h-screen bg-bg-base text-text-primary-on-dark p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-bg-surface-elevated rounded-lg p-8 text-center">
        <h1 className="text-2xl font-bold mb-3">{title}</h1>
        <p className="text-text-secondary-on-dark">{body}</p>
      </div>
    </main>
  );
}
