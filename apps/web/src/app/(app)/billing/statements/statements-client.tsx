'use client';

/**
 * Statement generation client. Form state stays here; we POST to the
 * BFF for preview + send. Preview opens an inline modal with the
 * formatted statement; Send composes a default subject/body and fires
 * to the API which records a row in statement_sends.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientSendStatement } from '@/lib/api/ar-client';
import type { StatementPreviewResponse, StatementSendDto } from '@ustowdispatch/shared';
import { Download, Eye, Mail, Printer, RefreshCw, X } from 'lucide-react';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  accounts: Array<{ id: string; name: string; billingEmail: string | null }>;
  recentSends: StatementSendDto[];
  preselectedAccountId: string | null;
}

export function StatementsClient({
  accounts,
  recentSends,
  preselectedAccountId,
}: Props): JSX.Element {
  const [accountId, setAccountId] = useState(preselectedAccountId ?? accounts[0]?.id ?? '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('all');
  const [preview, setPreview] = useState<StatementPreviewResponse | null>(null);
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sends, setSends] = useState<StatementSendDto[]>(recentSends);
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === accountId);

  const payload = {
    accountId,
    ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { dateTo: new Date(dateTo).toISOString() } : {}),
    invoiceFilter: filter,
  };

  const runPreview = async (): Promise<void> => {
    if (!accountId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/ar/statements/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(b?.message ?? `Preview failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as StatementPreviewResponse;
      setPreview(data);
      setRecipient(data.billingEmail ?? '');
      setSubject(`Statement of account — as of ${data.asOf.slice(0, 10)}`);
      setBody(
        `Hello,\n\nPlease find your statement of account attached, as of ${data.asOf.slice(0, 10)}.\n\nTotal balance: $${(data.aging.totalCents / 100).toFixed(2)} across ${data.invoices.length} invoice(s).\n\nThank you,\nAccounts Receivable`,
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async (): Promise<void> => {
    if (!accountId) return;
    const res = await fetch('/api/ar/statements/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      toast.error(`PDF download failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${accountId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendEmail = async (): Promise<void> => {
    if (!recipient) {
      toast.error('Recipient email required');
      return;
    }
    setBusy(true);
    try {
      const sent = await clientSendStatement({
        ...payload,
        recipientEmail: recipient,
        subject,
        body,
      });
      setSends((prev) => [sent, ...prev]);
      setShowEmail(false);
      setPreview(null);
      toast.success(`Statement emailed to ${recipient}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          Statements
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Generate, preview, email, and audit per-account statements of account.
        </p>
      </header>

      <section className="rounded-lg border border-divider bg-bg-surface p-4">
        <h2 className="font-condensed text-base font-bold uppercase">Generate new statement</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Account
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-divider bg-bg-base px-2 py-2 text-sm"
            >
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              From
            </span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              To
            </span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <div>
            <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Include
            </span>
            {(['all', 'open', 'paid'] as const).map((v) => (
              <label key={v} className="mr-3 text-sm">
                <input
                  type="radio"
                  checked={filter === v}
                  onChange={() => setFilter(v)}
                  className="mr-1"
                />
                {v === 'all' ? 'All invoices' : v === 'open' ? 'Open invoices' : 'Paid only'}
              </label>
            ))}
          </div>
          <Button onClick={runPreview} disabled={busy || !accountId} className="ml-auto">
            <Eye className="mr-1.5 h-4 w-4" /> Preview statement
          </Button>
        </div>
      </section>

      {preview ? (
        <PreviewPanel
          preview={preview}
          tenantNameFallback="US Tow DISPATCH"
          onClose={() => setPreview(null)}
          onDownload={downloadPdf}
          onEmail={() => setShowEmail(true)}
          onPrint={() => window.print()}
        />
      ) : null}

      {showEmail && preview ? (
        <EmailComposeModal
          recipient={recipient}
          setRecipient={setRecipient}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          onSend={sendEmail}
          onCancel={() => setShowEmail(false)}
          busy={busy}
          fallbackEmail={selectedAccount?.billingEmail ?? null}
        />
      ) : null}

      <section className="rounded-lg border border-divider bg-bg-surface p-4">
        <h2 className="font-condensed text-base font-bold uppercase">Recent statement sends</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-surface/60 text-left">
              <tr>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Sent
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Account
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Recipient
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Period
                </th>
                <th className="px-3 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Total
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Sender
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {sends.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-text-secondary-on-dark">
                    No statement sends yet.
                  </td>
                </tr>
              ) : (
                sends.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {s.sentAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2">{s.accountName ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.sentTo}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.dateFrom ? s.dateFrom.slice(0, 10) : '—'} →{' '}
                      {s.dateTo ? s.dateTo.slice(0, 10) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(s.totalCents)}</td>
                    <td className="px-3 py-2 text-xs">{s.sentByName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          s.status === 'sent'
                            ? 'bg-green-700 text-white'
                            : s.status === 'failed'
                              ? 'bg-danger text-white'
                              : 'bg-bg-surface-elevated text-text-secondary-on-dark'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PreviewPanel({
  preview,
  tenantNameFallback,
  onClose,
  onDownload,
  onEmail,
  onPrint,
}: {
  preview: StatementPreviewResponse;
  tenantNameFallback: string;
  onClose: () => void;
  onDownload: () => void;
  onEmail: () => void;
  onPrint: () => void;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-orange/40 bg-bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-condensed text-base font-bold uppercase">
          Preview — {preview.accountName}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-text-secondary-on-dark hover:text-text-primary-on-dark"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4 rounded-md border border-divider bg-bg-base p-4 print:bg-white print:text-black">
        <div className="text-sm">
          <p className="font-bold">{tenantNameFallback}</p>
          <p className="text-text-secondary-on-dark print:text-gray-700">
            Statement of Account — as of {preview.asOf.slice(0, 10)}
          </p>
        </div>
        <hr className="border-divider" />
        <div className="text-sm">
          <p className="font-semibold">{preview.accountName}</p>
          {preview.billingEmail ? (
            <p className="text-text-secondary-on-dark print:text-gray-700">
              {preview.billingEmail}
            </p>
          ) : null}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-secondary-on-dark print:text-gray-700">
              <th className="py-1">Invoice #</th>
              <th className="py-1">Issued</th>
              <th className="py-1">Due</th>
              <th className="py-1 text-right">Total</th>
              <th className="py-1 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {preview.invoices.map((i) => (
              <tr key={i.invoiceId}>
                <td className="py-1 font-mono">{i.invoiceNumber}</td>
                <td className="py-1">{i.issuedAt?.slice(0, 10) ?? '—'}</td>
                <td className="py-1">{i.dueAt?.slice(0, 10) ?? '—'}</td>
                <td className="py-1 text-right font-mono">{formatMoney(i.totalCents)}</td>
                <td className="py-1 text-right font-mono font-semibold">
                  {formatMoney(i.balanceCents)}
                </td>
              </tr>
            ))}
            {preview.invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-text-secondary-on-dark">
                  No invoices in this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="grid grid-cols-6 gap-2 text-xs">
          <Bucket label="Current" value={preview.aging.currentDueCents} />
          <Bucket label="1-30" value={preview.aging.bucket1To30Cents} />
          <Bucket label="31-60" value={preview.aging.bucket31To60Cents} />
          <Bucket label="61-90" value={preview.aging.bucket61To90Cents} />
          <Bucket label="91+" value={preview.aging.bucket91PlusCents} />
          <Bucket label="Total" value={preview.aging.totalCents} bold />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <Button onClick={onDownload} variant="ghost">
          <Download className="mr-1.5 h-4 w-4" /> Download PDF
        </Button>
        <Button onClick={onEmail}>
          <Mail className="mr-1.5 h-4 w-4" /> Email to account
        </Button>
        <Button onClick={onPrint} variant="ghost">
          <Printer className="mr-1.5 h-4 w-4" /> Print
        </Button>
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
      </div>
    </section>
  );
}

function EmailComposeModal({
  recipient,
  setRecipient,
  subject,
  setSubject,
  body,
  setBody,
  onSend,
  onCancel,
  busy,
  fallbackEmail,
}: {
  recipient: string;
  setRecipient: (v: string) => void;
  subject: string;
  setSubject: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  onSend: () => void | Promise<void>;
  onCancel: () => void;
  busy: boolean;
  fallbackEmail: string | null;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl space-y-3 rounded-lg border border-divider bg-bg-surface p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-condensed text-lg font-bold uppercase">Email statement</h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-text-secondary-on-dark hover:text-text-primary-on-dark"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            To
          </span>
          <Input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={fallbackEmail ?? 'recipient@example.com'}
          />
        </div>
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Subject
          </span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Body
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-divider bg-bg-base p-2 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button onClick={() => void onSend()} disabled={busy || !recipient}>
            {busy ? (
              <>
                <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Mail className="mr-1.5 h-4 w-4" /> Send
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Bucket({
  label,
  value,
  bold = false,
}: { label: string; value: number; bold?: boolean }): JSX.Element {
  return (
    <div className="rounded border border-divider p-2">
      <p className="text-[9px] uppercase tracking-wider text-text-secondary-on-dark print:text-gray-700">
        {label}
      </p>
      <p className={`mt-0.5 font-mono ${bold ? 'font-bold' : ''}`}>{formatMoney(value)}</p>
    </div>
  );
}

function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}
