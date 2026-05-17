'use client';

import type {
  DriverSummaryDto,
  InvoiceReviewDto,
  UpdateInvoiceReviewPayload,
} from '@ustowdispatch/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

interface Props {
  review: InvoiceReviewDto;
  allDrivers: Array<{ id: string; name: string; defaultCommissionPct: number | null }>;
}

interface LineEdit {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  lineTotalCents: number;
  taxable: boolean;
  taxRatePct: string;
}

interface CommissionEdit {
  lineItemId: string;
  driverId: string;
  commissionPct: number;
}

const fmtMoney = (cents: number): string => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const d = Math.floor(abs / 100);
  const r = abs % 100;
  return `${sign}$${d.toLocaleString('en-US')}.${String(r).padStart(2, '0')}`;
};

export function InvoiceReviewClient({ review, allDrivers }: Props): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(review.invoice.notes ?? '');
  const [lines, setLines] = useState<LineEdit[]>(() =>
    review.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      unitPriceCents: li.unitPriceCents,
      lineTotalCents: li.lineTotalCents,
      taxable: li.taxable,
      taxRatePct: li.taxRatePct,
    })),
  );
  const [assignedDrivers, setAssignedDrivers] = useState<DriverSummaryDto[]>(
    review.assignedDrivers,
  );
  const [commissions, setCommissions] = useState<CommissionEdit[]>(() =>
    review.commissions.map((c) => ({
      lineItemId: c.invoiceLineItemId,
      driverId: c.driverId,
      commissionPct: c.commissionPct,
    })),
  );
  const [ackUnallocated, setAckUnallocated] = useState(false);

  const linesById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const driverNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of assignedDrivers) m.set(d.id, d.name);
    for (const d of allDrivers) if (!m.has(d.id)) m.set(d.id, d.name);
    return m;
  }, [assignedDrivers, allDrivers]);

  // ----- derived -----

  const subtotal = lines.reduce((a, l) => a + l.lineTotalCents, 0);
  const totalTax = lines.reduce((a, l) => {
    if (!l.taxable) return a;
    const rate = Number(l.taxRatePct);
    if (!Number.isFinite(rate) || rate === 0) return a;
    return a + Math.round(l.lineTotalCents * (rate / 100));
  }, 0);
  const total = subtotal + totalTax;

  const commByLine = useMemo(() => {
    const m = new Map<string, CommissionEdit[]>();
    for (const c of commissions) {
      const arr = m.get(c.lineItemId) ?? [];
      arr.push(c);
      m.set(c.lineItemId, arr);
    }
    return m;
  }, [commissions]);

  const perLineSums = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of commissions) {
      m.set(c.lineItemId, (m.get(c.lineItemId) ?? 0) + c.commissionPct);
    }
    return m;
  }, [commissions]);

  const anyOver100 = Array.from(perLineSums.values()).some((s) => s > 100 + 1e-6);
  const anyUnder100 = lines.some((l) => {
    const sum = perLineSums.get(l.id) ?? 0;
    return sum < 100 - 1e-6;
  });

  const grandCommissionCents = commissions.reduce((a, c) => {
    const line = linesById.get(c.lineItemId);
    if (!line) return a;
    return a + Math.round((line.lineTotalCents * c.commissionPct) / 100);
  }, 0);

  const perDriverCents = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of commissions) {
      const line = linesById.get(c.lineItemId);
      if (!line) continue;
      const cents = Math.round((line.lineTotalCents * c.commissionPct) / 100);
      m.set(c.driverId, (m.get(c.driverId) ?? 0) + cents);
    }
    return m;
  }, [commissions, linesById]);

  const postDisabled = busy || anyOver100 || lines.length === 0 || (anyUnder100 && !ackUnallocated);

  // ----- mutations -----

  function updateLine(id: string, patch: Partial<LineEdit>): void {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        // Recompute line total when qty or unit price changes.
        if (patch.quantity !== undefined || patch.unitPriceCents !== undefined) {
          const q = Number(next.quantity);
          if (Number.isFinite(q)) {
            next.lineTotalCents = Math.round(q * next.unitPriceCents);
          }
        }
        return next;
      }),
    );
  }

  function deleteLine(id: string): void {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setCommissions((prev) => prev.filter((c) => c.lineItemId !== id));
  }

  function addDriverChip(driverId: string): void {
    if (assignedDrivers.some((d) => d.id === driverId)) return;
    const meta = allDrivers.find((d) => d.id === driverId);
    if (!meta) return;
    setAssignedDrivers((prev) => [
      ...prev,
      { id: meta.id, name: meta.name, defaultCommissionPct: meta.defaultCommissionPct },
    ]);
  }

  function removeDriverChip(driverId: string): void {
    setAssignedDrivers((prev) => prev.filter((d) => d.id !== driverId));
    setCommissions((prev) => prev.filter((c) => c.driverId !== driverId));
  }

  function setCommissionPct(lineItemId: string, driverId: string, pct: number): void {
    setCommissions((prev) => {
      const idx = prev.findIndex((c) => c.lineItemId === lineItemId && c.driverId === driverId);
      if (idx === -1) {
        return [...prev, { lineItemId, driverId, commissionPct: pct }];
      }
      const next = [...prev];
      next[idx] = { lineItemId, driverId, commissionPct: pct };
      return next;
    });
  }

  function clearCommission(lineItemId: string, driverId: string): void {
    setCommissions((prev) =>
      prev.filter((c) => !(c.lineItemId === lineItemId && c.driverId === driverId)),
    );
  }

  // ----- save + post -----

  async function callJson<T>(method: 'POST' | 'PATCH', url: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json' },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      let msg: string;
      try {
        const j = JSON.parse(text) as { message?: string };
        msg = j.message ?? text;
      } catch {
        msg = text;
      }
      throw new Error(msg || `Request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async function persistAdditionalDriverChips(): Promise<void> {
    // Drivers in our chip list that aren't in review.assignedDrivers are
    // new — ask the API to record them on the job. Idempotent.
    if (!review.job) return;
    const original = new Set(review.assignedDrivers.map((d) => d.id));
    const adds = assignedDrivers.filter((d) => !original.has(d.id));
    for (const d of adds) {
      try {
        await callJson('POST', `/api/jobs/${review.job.id}/drivers`, {
          driverId: d.id,
          role: 'support',
        });
      } catch (err) {
        // Tolerate "already assigned" — re-running this is safe; surface
        // anything else.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already/i.test(msg)) throw err;
      }
    }
  }

  async function savePatch(): Promise<void> {
    const patch: UpdateInvoiceReviewPayload = {
      lineItems: lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        taxable: l.taxable,
        taxRatePct: l.taxRatePct,
      })),
      commissions: commissions.map((c) => ({
        lineItemId: c.lineItemId,
        driverId: c.driverId,
        commissionPct: c.commissionPct,
      })),
      notes,
      assignedDriverIds: assignedDrivers.map((d) => d.id),
    };
    await callJson('PATCH', `/api/billing/invoices/${review.invoice.id}/review`, patch);
  }

  async function handleSave(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await persistAdditionalDriverChips();
      await savePatch();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePost(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await persistAdditionalDriverChips();
      await savePatch();
      await callJson('POST', `/api/billing/invoices/${review.invoice.id}/post`);
      router.push(`/billing/invoices/${review.invoice.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(id: string): void {
    // Optimistic UI — server delete fires on save via PATCH (lineItems
    // overwrite). For draft hard-delete we go through the existing
    // /line-items DELETE endpoint so the server-side state matches.
    setBusy(true);
    setError(null);
    fetch(`/api/billing/invoices/${review.invoice.id}/line-items/${id}`, { method: 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
        deleteLine(id);
        router.refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  // ----- render -----

  const eligibleToAdd = allDrivers.filter((d) => !assignedDrivers.some((a) => a.id === d.id));

  return (
    <div className="space-y-6" data-testid="invoice-review-client">
      {error ? (
        <div
          className="rounded-md border border-red-700 bg-red-700/10 px-3 py-2 text-sm text-red-300"
          data-testid="invoice-review-error"
        >
          {error}
        </div>
      ) : null}

      {/* ─── TOP SECTION: customer invoice ─── */}
      <section className="rounded-lg border border-divider" data-testid="customer-invoice-section">
        <header className="border-b border-divider bg-bg-surface/60 px-4 py-2">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Customer invoice
          </h2>
        </header>
        <table className="w-full divide-y divide-divider text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Description
              </th>
              <th className="px-2 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Qty
              </th>
              <th className="px-2 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Unit
              </th>
              <th className="px-2 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Unit price
              </th>
              <th className="px-2 py-2 text-right text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
                Amount
              </th>
              <th className="px-2 py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {lines.map((l) => (
              <tr key={l.id} data-testid={`line-row-${l.id}`}>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={l.description}
                    onChange={(e) => updateLine(l.id, { description: e.target.value })}
                    className="w-full rounded border border-divider bg-bg-surface px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={l.quantity}
                    onChange={(e) => updateLine(l.id, { quantity: e.target.value })}
                    className="w-20 rounded border border-divider bg-bg-surface px-2 py-1 text-right text-sm font-mono"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={l.unit}
                    onChange={(e) => updateLine(l.id, { unit: e.target.value })}
                    className="w-20 rounded border border-divider bg-bg-surface px-2 py-1 text-right text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    value={(l.unitPriceCents / 100).toFixed(2)}
                    onChange={(e) => {
                      const n = Math.round(Number.parseFloat(e.target.value || '0') * 100);
                      if (Number.isFinite(n)) updateLine(l.id, { unitPriceCents: n });
                    }}
                    step="0.01"
                    className="w-24 rounded border border-divider bg-bg-surface px-2 py-1 text-right text-sm font-mono"
                  />
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtMoney(l.lineTotalCents)}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleDelete(l.id)}
                    disabled={busy}
                    className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-700/10 disabled:opacity-50"
                    data-testid={`delete-line-${l.id}`}
                    aria-label="Delete line"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-text-secondary-on-dark-on-dark/60"
                >
                  No line items.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="bg-bg-surface/30">
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right text-text-secondary-on-dark">
                Subtotal
              </td>
              <td className="px-2 py-2 text-right font-mono" data-testid="review-subtotal">
                {fmtMoney(subtotal)}
              </td>
              <td />
            </tr>
            <tr>
              <td colSpan={4} className="px-4 py-1 text-right text-text-secondary-on-dark">
                Tax
              </td>
              <td className="px-2 py-1 text-right font-mono" data-testid="review-tax">
                {fmtMoney(totalTax)}
              </td>
              <td />
            </tr>
            <tr className="border-t border-divider">
              <td colSpan={4} className="px-4 py-2 text-right font-semibold">
                Total
              </td>
              <td className="px-2 py-2 text-right font-mono font-bold" data-testid="review-total">
                {fmtMoney(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className="border-t border-divider p-4">
          <label className="block text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-divider bg-bg-surface px-2 py-1 text-sm"
              data-testid="review-notes-input"
            />
          </label>
        </div>
      </section>

      {/* ─── BOTTOM SECTION: commission worksheet ─── */}
      <section
        className="rounded-lg border border-divider"
        data-testid="commission-worksheet-section"
      >
        <header className="border-b border-divider bg-bg-surface/60 px-4 py-2">
          <h2 className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
            Driver commission worksheet
            <span className="ml-2 normal-case text-[10px] text-text-secondary-on-dark-on-dark/40">
              Admin / dispatcher only — never visible to drivers
            </span>
          </h2>
        </header>

        <div className="space-y-4 p-4">
          {/* Assigned driver chips + add-driver picker */}
          <div className="flex flex-wrap items-center gap-2" data-testid="driver-chips">
            <span className="text-xs uppercase tracking-wider text-text-secondary-on-dark-on-dark/60">
              Drivers
            </span>
            {assignedDrivers.map((d) => (
              <span
                key={d.id}
                className="flex items-center gap-1 rounded-full bg-bg-surface-elevated px-2 py-0.5 text-xs"
                data-testid={`driver-chip-${d.id}`}
              >
                {d.name}
                <button
                  type="button"
                  onClick={() => removeDriverChip(d.id)}
                  className="rounded-full bg-divider px-1 text-[10px] hover:bg-red-700/20"
                  aria-label={`Remove ${d.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            {eligibleToAdd.length > 0 ? (
              <select
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) {
                    addDriverChip(id);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                className="rounded border border-divider bg-bg-surface px-2 py-0.5 text-xs"
                data-testid="add-driver-select"
              >
                <option value="">+ Add driver</option>
                {eligibleToAdd.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {/* Per-line commission allocation */}
          {lines.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark-on-dark/60">
              Add a line item to allocate commissions.
            </p>
          ) : assignedDrivers.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark-on-dark/60">
              Assign a driver above to allocate commissions.
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((l) => {
                const sum = perLineSums.get(l.id) ?? 0;
                const remaining = 100 - sum;
                const over = sum > 100 + 1e-6;
                return (
                  <div
                    key={l.id}
                    className={`rounded-md border p-3 ${over ? 'border-red-700' : 'border-divider'}`}
                    data-testid={`commission-block-${l.id}`}
                  >
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm font-medium">
                        {l.description}{' '}
                        <span className="font-mono text-xs text-text-secondary-on-dark">
                          {fmtMoney(l.lineTotalCents)}
                        </span>
                      </p>
                      <p
                        className={`text-xs ${over ? 'text-red-400' : 'text-text-secondary-on-dark'}`}
                        data-testid={`commission-summary-${l.id}`}
                      >
                        Total committed: {sum.toFixed(2)}% · Remaining:{' '}
                        {Math.max(remaining, 0).toFixed(2)}%
                      </p>
                    </div>
                    <table className="mt-2 w-full text-sm">
                      <tbody>
                        {assignedDrivers.map((d) => {
                          const c = commByLine.get(l.id)?.find((x) => x.driverId === d.id);
                          const pct = c?.commissionPct ?? 0;
                          const cents = Math.round((l.lineTotalCents * pct) / 100);
                          return (
                            <tr key={d.id}>
                              <td className="py-1 text-sm">{d.name}</td>
                              <td className="py-1 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={pct}
                                  onChange={(e) => {
                                    const n = Number.parseFloat(e.target.value || '0');
                                    if (Number.isFinite(n)) setCommissionPct(l.id, d.id, n);
                                  }}
                                  className="w-20 rounded border border-divider bg-bg-surface px-2 py-1 text-right text-sm font-mono"
                                  data-testid={`commission-pct-${l.id}-${d.id}`}
                                />
                                <span className="ml-1 text-xs">%</span>
                              </td>
                              <td className="w-24 py-1 text-right font-mono">{fmtMoney(cents)}</td>
                              <td className="w-8 py-1 text-right">
                                {pct > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => clearCommission(l.id, d.id)}
                                    className="rounded px-1 text-xs text-text-secondary-on-dark hover:bg-divider"
                                    aria-label="Clear"
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {/* Grand total + per-driver summary */}
          <div className="rounded-md border border-divider bg-bg-surface/40 p-3 text-sm">
            <p className="font-semibold">
              Grand total commissions:{' '}
              <span className="font-mono" data-testid="grand-commission-total">
                {fmtMoney(grandCommissionCents)}
              </span>
            </p>
            <ul className="mt-2 space-y-1" data-testid="per-driver-summary">
              {assignedDrivers.map((d) => {
                const cents = perDriverCents.get(d.id) ?? 0;
                return (
                  <li key={d.id} className="flex justify-between text-xs">
                    <span>{d.name}</span>
                    <span className="font-mono">{fmtMoney(cents)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── Footer: ack + actions ─── */}
      <div className="space-y-2 rounded-md border border-divider p-3">
        {anyUnder100 && lines.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-text-secondary-on-dark">
            <input
              type="checkbox"
              checked={ackUnallocated}
              onChange={(e) => setAckUnallocated(e.target.checked)}
              data-testid="ack-unallocated-checkbox"
            />
            OK to leave uncommitted % unallocated on one or more lines
          </label>
        ) : null}
        {anyOver100 ? (
          <p className="text-xs text-red-400" data-testid="commission-over-100-warning">
            One or more lines have commissions summing over 100% — fix before posting.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md bg-bg-surface-elevated px-4 py-1.5 text-sm hover:bg-divider"
            data-testid="review-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="rounded-md bg-bg-surface-elevated px-4 py-1.5 text-sm hover:bg-divider disabled:opacity-50"
            data-testid="review-save-btn"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void handlePost()}
            disabled={postDisabled}
            className="rounded-md bg-brand-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-primary-hover disabled:opacity-50"
            data-testid="review-post-btn"
          >
            Post invoice →
          </button>
        </div>
      </div>
    </div>
  );
}
