'use client';
import { useUser } from '@/components/app-shell/session-provider';
import {
  clientCreateLienholder,
  clientDeleteLienholder,
  clientUpdateLienholder,
} from '@/lib/api/repo-client';
import type {
  CreateLienholderPayload,
  LienholderDto,
  LienholderInvoiceFormat,
} from '@ustowdispatch/shared';
import { lienholderInvoiceFormatValues } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function LienholdersClient({
  lienholders,
}: {
  lienholders: LienholderDto[];
}): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href="/repo/cases" className="text-accent-orange text-sm">
            ← Repo cases
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-1">Lienholders</h1>
          <p className="text-text-secondary-on-dark text-sm mt-1">
            The repossession clients you receive assignments from.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
          {error}
        </div>
      )}

      {canWrite && (
        <CreateLienholderForm
          busy={busy}
          onSubmit={(body) => run(() => clientCreateLienholder(body))}
        />
      )}

      <div className="bg-bg-surface-elevated rounded-md border border-border-on-dark overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-base/40 text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            <tr>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Contact</th>
              <th className="text-left px-4 py-2.5">Phone</th>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5">Format</th>
              <th className="text-left px-4 py-2.5">Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lienholders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No lienholders yet.
                </td>
              </tr>
            )}
            {lienholders.map((l) => (
              <tr key={l.id} className="border-t border-border-on-dark">
                <td className="px-4 py-2.5 font-semibold">{l.name}</td>
                <td className="px-4 py-2.5 text-text-secondary-on-dark">{l.contactName ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary-on-dark">{l.phone ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary-on-dark">{l.email ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary-on-dark">{l.invoiceFormat}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                      l.isActive
                        ? 'bg-status-success-on-dark/15 text-status-success-on-dark border border-status-success-on-dark/30'
                        : 'bg-bg-base text-text-secondary-on-dark border border-border-on-dark'
                    }`}
                  >
                    {l.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {canWrite && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(() => clientUpdateLienholder(l.id, { isActive: !l.isActive }))
                        }
                        className="px-2.5 py-1 rounded-md border border-border-on-dark text-xs disabled:opacity-50"
                      >
                        {l.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => clientDeleteLienholder(l.id))}
                        className="ml-2 px-2.5 py-1 rounded-md border border-status-warning/40 text-status-warning text-xs disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CreateLienholderForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: CreateLienholderPayload) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [invoiceFormat, setInvoiceFormat] = useState<LienholderInvoiceFormat>('basic');

  function reset(): void {
    setName('');
    setContactName('');
    setPhone('');
    setEmail('');
    setAddressLine1('');
    setInvoiceFormat('basic');
  }

  return (
    <form
      className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length === 0) return;
        onSubmit({
          name: name.trim(),
          ...(contactName ? { contactName } : {}),
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(addressLine1 ? { addressLine1 } : {}),
          invoiceFormat,
        });
        reset();
      }}
    >
      <h2 className="font-semibold mb-3">Add lienholder</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Contact (optional)</span>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Phone (optional)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Email (optional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Address (optional)</span>
          <input
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Invoice format</span>
          <select
            value={invoiceFormat}
            onChange={(e) => setInvoiceFormat(e.target.value as LienholderInvoiceFormat)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          >
            {lienholderInvoiceFormatValues.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
      >
        Add lienholder
      </button>
    </form>
  );
}
