'use client';

/** Client action buttons for the portal: logout and invoice pay (Session 32). */
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

export function PortalLogoutButton({ label }: { label: string }): JSX.Element {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm text-neutral-500 underline hover:text-neutral-700"
      onClick={async () => {
        await fetch('/api/portal/logout', { method: 'POST' }).catch(() => undefined);
        router.push('/portal/login');
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}

export function PortalPayButton({
  invoiceId,
  label,
}: {
  invoiceId: string;
  label: string;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      style={{ backgroundColor: 'var(--portal-accent)' }}
      className="inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/portal/invoices/${invoiceId}/pay-link`, { method: 'POST' });
          if (res.ok) {
            const body = (await res.json()) as { payUrl: string };
            window.location.href = body.payUrl;
            return;
          }
        } catch {
          // fall through to re-enable the button
        }
        setBusy(false);
      }}
    >
      {busy ? '…' : label}
    </button>
  );
}
