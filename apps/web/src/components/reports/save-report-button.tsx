'use client';

import type { ReportId, ReportScheduleCadence } from '@towcommand/shared';
import { useState } from 'react';

/**
 * SaveReportButton — opens a tiny dialog that captures a name + an optional
 * schedule, then POSTs to /api/reporting/saved.
 *
 * The dialog is a controlled <details> element so we don't need a portal /
 * focus-trap library for this scope; happy path is "type name → click save"
 * and dismiss with the same toggle.
 */
export function SaveReportButton({
  reportId,
  filters,
}: {
  reportId: ReportId;
  filters: Record<string, string>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState<ReportScheduleCadence | 'none'>('none');
  const [format, setFormat] = useState<'csv' | 'pdf'>('pdf');
  const [recipients, setRecipients] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = (): void => {
    setOpen(false);
    setName('');
    setSchedule('none');
    setFormat('pdf');
    setRecipients('');
    setError(null);
  };

  const onSave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        reportId,
        name: name.trim(),
        filters,
      };
      if (schedule !== 'none') {
        const list = recipients
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (list.length === 0) {
          throw new Error('At least one recipient is required for a schedule.');
        }
        body.schedule = { cadence: schedule, format, recipients: list };
      }
      const res = await fetch('/api/reporting/saved', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const ebody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(ebody?.message ?? `Save failed (${res.status})`);
      }
      const saved = (await res.json()) as { name: string };
      setDone(saved.name);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md bg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-light"
      >
        Save & schedule
      </button>
      {done ? <p className="mt-1 text-xs text-ok">Saved “{done}”.</p> : null}
      {open ? (
        <div className="mt-3 w-80 rounded-lg border border-steel-border bg-steel-mid/80 p-3 text-sm">
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-steel-border bg-steel-mid px-2 py-1.5"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Schedule
            </span>
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as ReportScheduleCadence | 'none')}
              className="mt-1 w-full rounded border border-steel-border bg-steel-mid px-2 py-1.5"
            >
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {schedule !== 'none' ? (
            <>
              <label className="mt-3 block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Format
                </span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'csv' | 'pdf')}
                  className="mt-1 w-full rounded border border-steel-border bg-steel-mid px-2 py-1.5"
                >
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              <label className="mt-3 block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Recipients (comma-separated)
                </span>
                <input
                  type="text"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  className="mt-1 w-full rounded border border-steel-border bg-steel-mid px-2 py-1.5"
                />
              </label>
            </>
          ) : null}
          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-xs text-text-primary hover:bg-steel-light"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={busy || name.trim().length === 0}
              className="rounded-md bg-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-light disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
