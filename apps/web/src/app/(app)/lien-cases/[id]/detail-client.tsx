'use client';
import { useUser } from '@/components/app-shell/session-provider';
import {
  clientAdvanceCase,
  clientCloseCase,
  clientRecordNotice,
  clientRecordResponse,
  lienFormUrl,
} from '@/lib/api/lien-client';
import type {
  LienCaseDetailDto,
  LienDeliveryMethod,
  LienNoticeType,
  LienRecipientRole,
} from '@ustowdispatch/shared';
import {
  lienDeliveryMethodValues,
  lienNoticeTypeValues,
  lienRecipientRoleValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';
import {
  ACTION_LABEL,
  DELIVERY_METHOD_LABEL,
  NOTICE_TYPE_LABEL,
  RECIPIENT_ROLE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  STEP_LABEL,
  dueTone,
  formatCents,
  formatDate,
  formatDay,
} from '../lien-ui-helpers';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);

export function LienCaseDetailClient({ detail }: { detail: LienCaseDetailDto }): JSX.Element {
  const router = useRouter();
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = detail.case;
  const open = c.status === 'open';
  const readyForSale = c.status === 'ready_for_sale';

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
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href="/lien-cases" className="text-accent-orange text-sm">
            ← Lien cases
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">
            {detail.impound.vehicleDescription}
          </h1>
          <p className="text-text-secondary-on-dark text-sm mt-0.5">
            {c.state} · Case {c.id.slice(0, 8)} ·{' '}
            <span
              className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${STATUS_TONE[c.status]}`}
            >
              {STATUS_LABEL[c.status]}
            </span>
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
          {error}
        </div>
      )}

      {/* Next-action panel */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Next action
            </p>
            <p className="text-lg font-semibold mt-1">{ACTION_LABEL[detail.nextAction.action]}</p>
            {detail.nextAction.reasons.map((r) => (
              <p key={r} className="text-sm text-text-secondary-on-dark mt-0.5">
                {r}
              </p>
            ))}
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Due
            </p>
            <p className={`text-sm mt-1 ${dueTone(detail.nextAction.dueAt)}`}>
              {formatDay(detail.nextAction.dueAt)}
            </p>
          </div>
        </div>

        {canWrite && open && (
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => clientAdvanceCase(c.id, {}))}
              className="px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
            >
              Advance step
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Case + impound summary */}
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
          <h2 className="font-semibold mb-3">Case</h2>
          <Field label="Step" value={STEP_LABEL[c.currentStep]} />
          <Field label="Value tier" value={c.vehicleValueTier} />
          <Field
            label="Estimated value"
            value={c.estimatedValueCents !== null ? formatCents(c.estimatedValueCents) : '—'}
          />
          <Field label="Owner found" value={c.ownerFound ? 'Yes' : 'No'} />
          <Field label="Lienholder found" value={c.lienholderFound ? 'Yes' : 'No'} />
          <Field label="Opened" value={formatDate(c.openedAt)} />
          <Field label="Ready for sale" value={formatDate(c.readyForSaleAt)} />
          <hr className="my-3 border-border-on-dark" />
          <h2 className="font-semibold mb-3">Impounded vehicle</h2>
          <Field label="Plate" value={detail.impound.licensePlate ?? '—'} />
          <Field label="VIN" value={detail.impound.vehicleVin ?? '—'} />
          <Field label="Yard" value={detail.impound.yardName ?? '—'} />
          <Field label="Days stored" value={String(detail.impound.daysStored)} />
          <Field label="Accrued charges" value={formatCents(detail.impound.accruedFeeCents)} />
        </div>

        {/* Forms + close */}
        <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5 space-y-4">
          <div>
            <h2 className="font-semibold mb-3">State-form notices (PDF)</h2>
            <div className="flex flex-col gap-2">
              <a
                href={lienFormUrl(c.id, 'owner_notice')}
                target="_blank"
                rel="noreferrer"
                className="text-accent-orange text-sm"
              >
                ↓ Owner / lienholder notice ({c.state})
              </a>
              <a
                href={lienFormUrl(c.id, 'publication_notice')}
                target="_blank"
                rel="noreferrer"
                className="text-accent-orange text-sm"
              >
                ↓ Publication notice ({c.state})
              </a>
            </div>
          </div>

          {canWrite && (open || readyForSale) && (
            <ClosePanel
              busy={busy}
              readyForSale={readyForSale}
              onClose={(disposition, reason) =>
                run(() => clientCloseCase(c.id, { disposition, reason }))
              }
            />
          )}
        </div>
      </div>

      {/* Record a notice */}
      {canWrite && open && (
        <RecordNoticeForm
          busy={busy}
          onSubmit={(body) => run(() => clientRecordNotice(c.id, body))}
        />
      )}

      {/* Notices */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Notices</h2>
        {detail.notices.length === 0 ? (
          <p className="text-sm text-text-secondary-on-dark">No notices recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.notices.map((n) => (
              <li
                key={n.id}
                className="flex items-center justify-between gap-3 border-b border-border-on-dark pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {NOTICE_TYPE_LABEL[n.noticeType as LienNoticeType]} →{' '}
                    {RECIPIENT_ROLE_LABEL[n.recipientRole as LienRecipientRole]}
                  </p>
                  <p className="text-[11px] text-text-secondary-on-dark">
                    {DELIVERY_METHOD_LABEL[n.deliveryMethod as LienDeliveryMethod]} · sent{' '}
                    {formatDay(n.sentAt)}
                    {n.certifiedTrackingNo ? ` · #${n.certifiedTrackingNo}` : ''}
                    {n.responseReceivedAt ? ` · responded ${formatDay(n.responseReceivedAt)}` : ''}
                  </p>
                </div>
                {canWrite && open && !n.responseReceivedAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => clientRecordResponse(c.id, n.id, {}))}
                    className="px-2.5 py-1 rounded-md border border-border-on-dark text-xs disabled:opacity-50"
                  >
                    Record response
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <h2 className="font-semibold mb-3">Timeline</h2>
        <ul className="space-y-1.5">
          {detail.timeline.map((e) => (
            <li key={e.id} className="text-sm flex gap-3">
              <span className="text-text-secondary-on-dark whitespace-nowrap">
                {formatDate(e.occurredAt)}
              </span>
              <span className="font-medium">{e.eventType.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-text-secondary-on-dark">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function RecordNoticeForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: {
    noticeType: LienNoticeType;
    recipientRole: LienRecipientRole;
    deliveryMethod: LienDeliveryMethod;
    recipientName?: string;
    certifiedTrackingNo?: string;
  }) => void;
}): JSX.Element {
  const [noticeType, setNoticeType] = useState<LienNoticeType>('owner_notice');
  const [recipientRole, setRecipientRole] = useState<LienRecipientRole>('owner');
  const [deliveryMethod, setDeliveryMethod] = useState<LienDeliveryMethod>('certified_mail');
  const [recipientName, setRecipientName] = useState('');
  const [tracking, setTracking] = useState('');

  return (
    <form
      className="rounded-md border border-border-on-dark bg-bg-surface-elevated p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          noticeType,
          recipientRole,
          deliveryMethod,
          ...(recipientName ? { recipientName } : {}),
          ...(tracking ? { certifiedTrackingNo: tracking } : {}),
        });
      }}
    >
      <h2 className="font-semibold mb-3">Record a notice</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Notice type</span>
          <select
            value={noticeType}
            onChange={(e) => setNoticeType(e.target.value as LienNoticeType)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          >
            {lienNoticeTypeValues.map((t) => (
              <option key={t} value={t}>
                {NOTICE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Recipient</span>
          <select
            value={recipientRole}
            onChange={(e) => setRecipientRole(e.target.value as LienRecipientRole)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          >
            {lienRecipientRoleValues.map((r) => (
              <option key={r} value={r}>
                {RECIPIENT_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Delivery method</span>
          <select
            value={deliveryMethod}
            onChange={(e) => setDeliveryMethod(e.target.value as LienDeliveryMethod)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          >
            {lienDeliveryMethodValues.map((m) => (
              <option key={m} value={m}>
                {DELIVERY_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">Recipient name (optional)</span>
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary-on-dark mb-1">
            Certified tracking # (optional)
          </span>
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 px-3 py-1.5 rounded-md bg-accent-orange text-white text-sm font-semibold disabled:opacity-50"
      >
        Record notice
      </button>
    </form>
  );
}

function ClosePanel({
  busy,
  readyForSale,
  onClose,
}: {
  busy: boolean;
  readyForSale: boolean;
  onClose: (disposition: 'sold' | 'closed' | 'canceled', reason?: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <div>
      <h2 className="font-semibold mb-2">Close case</h2>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="w-full bg-bg-base border border-border-on-dark rounded-md px-2 py-1.5 text-sm mb-2"
      />
      <div className="flex flex-wrap gap-2">
        {readyForSale && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose('sold', reason || undefined)}
            className="px-3 py-1.5 rounded-md bg-status-success-on-dark/20 text-status-success-on-dark border border-status-success-on-dark/40 text-sm disabled:opacity-50"
          >
            Record sale
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onClose('closed', reason || undefined)}
          className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50"
        >
          Close
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onClose('canceled', reason || undefined)}
          className="px-3 py-1.5 rounded-md border border-border-on-dark text-sm disabled:opacity-50"
        >
          Cancel case
        </button>
      </div>
    </div>
  );
}
