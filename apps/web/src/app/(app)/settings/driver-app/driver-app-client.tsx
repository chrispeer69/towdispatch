'use client';

/**
 * DriverAppClient — operator-side editor for the Daily Briefing the
 * driver app shows after PIN sign-in.
 *
 * State machine:
 *   - On mount, GET /api/driver-briefings/active. 200 → load row into form.
 *     null → blank form (no briefing yet).
 *   - Save (Create) when no row exists: POST /api/driver-briefings.
 *   - Save (Update) when a row exists: PATCH /api/driver-briefings/:id.
 *   - "Publish to drivers" toggle = isActive flag on the form. Saving with
 *     isActive=true automatically deactivates the previous active row
 *     (server-side partial unique constraint).
 *   - "Deactivate" button just patches isActive=false.
 */

import { useEffect, useState } from 'react';

interface BriefingRow {
  id: string;
  title: string;
  message: string;
  videoUrl: string | null;
  videoMinDurationSeconds: number;
  isActive: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  title: string;
  message: string;
  videoUrl: string;
  videoMinDurationSeconds: number;
  isActive: boolean;
}

const EMPTY: FormState = {
  title: '',
  message: '',
  videoUrl: '',
  videoMinDurationSeconds: 60,
  isActive: false,
};

export function DriverAppClient(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [existing, setExisting] = useState<BriefingRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/driver-briefings/active', { cache: 'no-store' });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Load failed (${r.status})`);
      }
      const data = (await r.json()) as BriefingRow | null;
      if (data) {
        setExisting(data);
        setForm({
          title: data.title ?? '',
          message: data.message ?? '',
          videoUrl: data.videoUrl ?? '',
          videoMinDurationSeconds: data.videoMinDurationSeconds ?? 60,
          isActive: data.isActive ?? false,
        });
      } else {
        setExisting(null);
        setForm(EMPTY);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSavedAt(null);
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      message: form.message.trim(),
      videoMinDurationSeconds: form.videoMinDurationSeconds,
      isActive: form.isActive,
    };
    if (form.videoUrl.trim()) payload.videoUrl = form.videoUrl.trim();
    try {
      const url = existing ? `/api/driver-briefings/${existing.id}` : '/api/driver-briefings';
      const method = existing ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Save failed (${r.status})`);
      }
      const data = (await r.json()) as BriefingRow;
      setExisting(data);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(): Promise<void> {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/driver-briefings/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Deactivate failed (${r.status})`);
      }
      const data = (await r.json()) as BriefingRow;
      setExisting(data);
      setForm((f) => ({ ...f, isActive: false }));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-md border border-divider bg-bg-surface p-6 text-sm text-text-secondary-on-dark">
        Loading briefing…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-divider bg-bg-surface p-6 space-y-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Status
          </p>
          <p className="mt-1 text-base font-semibold">
            {existing
              ? form.isActive
                ? 'Briefing is published to drivers'
                : 'Briefing exists but is not published'
              : 'No briefing on file yet'}
          </p>
          {existing ? (
            <p className="mt-0.5 text-xs text-text-secondary-on-dark">
              Last updated {new Date(existing.updatedAt).toLocaleString()}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="briefing-title"
            className="text-xs font-mono uppercase tracking-wide text-text-secondary-on-dark"
          >
            Title
          </label>
          <input
            id="briefing-title"
            type="text"
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Tuesday, December 19 — Watch your tow chains in this cold"
            className="w-full rounded-md border border-divider bg-bg-base px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="briefing-message"
            className="text-xs font-mono uppercase tracking-wide text-text-secondary-on-dark"
          >
            Message (drivers must acknowledge)
          </label>
          <textarea
            id="briefing-message"
            rows={6}
            maxLength={8000}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Type the message every driver should read at the start of their shift. Keep it short, specific, and action-oriented."
            className="w-full rounded-md border border-divider bg-bg-base px-3 py-2 text-sm"
          />
          <p className="text-xs text-text-secondary-on-dark">
            {form.message.length} / 8000 characters
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="briefing-video-url"
            className="text-xs font-mono uppercase tracking-wide text-text-secondary-on-dark"
          >
            Video URL (optional)
          </label>
          <input
            id="briefing-video-url"
            type="url"
            maxLength={2000}
            value={form.videoUrl}
            onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
            placeholder="https://… (S3 mp4, Loom, YouTube, or any direct video URL)"
            className="w-full rounded-md border border-divider bg-bg-base px-3 py-2 text-sm"
          />
          <p className="text-xs text-text-secondary-on-dark">
            Drivers must watch at least the minimum duration below before they can acknowledge.
            Leave blank to ship a text-only briefing.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="briefing-min-duration"
            className="text-xs font-mono uppercase tracking-wide text-text-secondary-on-dark"
          >
            Minimum watch time (seconds)
          </label>
          <input
            id="briefing-min-duration"
            type="number"
            min={0}
            max={3600}
            value={form.videoMinDurationSeconds}
            onChange={(e) =>
              setForm({ ...form, videoMinDurationSeconds: Number(e.target.value) || 0 })
            }
            className="w-32 rounded-md border border-divider bg-bg-base px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-3 rounded-md border border-divider bg-bg-base p-4">
          <input
            id="briefing-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="h-5 w-5"
          />
          <label htmlFor="briefing-active" className="text-sm">
            <span className="font-semibold">Publish this briefing to all drivers</span>
            <span className="block text-xs text-text-secondary-on-dark">
              When checked, every driver will see this on their first sign-in today and be required
              to read + watch before taking jobs. Saving with this on automatically retires whatever
              briefing was active before.
            </span>
          </label>
        </div>

        {error ? (
          <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
        {savedAt ? (
          <div className="rounded-md border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
            Saved at {savedAt}.
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !form.title.trim() || !form.message.trim()}
            className="rounded-md bg-brand-primary px-5 py-2 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Create briefing'}
          </button>
          {existing && form.isActive ? (
            <button
              type="button"
              onClick={() => void deactivate()}
              disabled={busy}
              className="rounded-md border border-divider px-5 py-2 text-sm font-semibold uppercase tracking-wide hover:bg-bg-surface-elevated"
            >
              Unpublish
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="rounded-md border border-divider px-5 py-2 text-sm font-semibold uppercase tracking-wide hover:bg-bg-surface-elevated"
          >
            Reload
          </button>
        </div>
      </section>

      <section className="rounded-md border border-divider bg-bg-surface p-6 space-y-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark">
          How drivers see this
        </h3>
        <p className="text-sm">
          On their first sign-in of the day, drivers see a banner with the title and message. They
          have to acknowledge it before taking any jobs. If a video URL is set, it has to play for
          at least the minimum-watch threshold before the acknowledge button enables.
        </p>
        <p className="text-sm">
          Once acknowledged, the briefing is silent for the rest of the day for that driver. The
          next day it appears again. Publishing a new briefing while an old one is active replaces
          it cleanly — drivers who saw the old one yesterday will see the new one today.
        </p>
      </section>

      <TrainingLog />
    </div>
  );
}

/**
 * Training completion log. Operators care about formal records:
 * who acknowledged which briefing, when, and on what device. The
 * server returns rows pre-joined with driver name + briefing title
 * so the table can render without an N+1.
 *
 * The CSV button calls the same endpoint with `?limit=5000` and
 * serializes client-side. We keep CSV serialization local rather
 * than adding a server-side `?format=csv` branch because the data
 * volume is small and HR records are happier with a UTF-8 CSV than
 * an Excel-flavored XLSX.
 */
function TrainingLog(): JSX.Element {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      driverId: string;
      driverName: string;
      briefingId: string;
      briefingTitle: string;
      acknowledgedDate: string;
      messageReadAt: string | null;
      videoCompletedAt: string | null;
      acknowledgedAt: string;
      ipAddress: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/driver-briefings/acknowledgments?limit=500', {
        cache: 'no-store',
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Load failed (${r.status})`);
      }
      const data = (await r.json()) as typeof rows;
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mount-only.
  useEffect(() => {
    void load();
  }, []);

  function downloadCsv(): void {
    const header = [
      'Acknowledged date',
      'Acknowledged at (UTC)',
      'Driver',
      'Briefing title',
      'Message read at',
      'Video completed at',
      'IP address',
    ];
    const csvEscape = (v: string | null): string => {
      if (v == null) return '';
      // RFC 4180: wrap in quotes if value contains comma, quote, or newline.
      if (/[,"\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.acknowledgedDate,
          r.acknowledgedAt,
          r.driverName,
          r.briefingTitle,
          r.messageReadAt ?? '',
          r.videoCompletedAt ?? '',
          r.ipAddress ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `driver-training-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-md border border-divider bg-bg-surface p-6 space-y-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-secondary-on-dark">
            Training completion log
          </h3>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Formal record of every driver acknowledgment. Use this for HR / compliance filings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:bg-bg-surface-elevated"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={rows.length === 0}
            className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
          >
            Download CSV
          </button>
        </div>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-text-secondary-on-dark">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary-on-dark">No acknowledgments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Driver</th>
                <th className="py-2 pr-4">Briefing title</th>
                <th className="py-2 pr-4">Read at</th>
                <th className="py-2 pr-4">Video done</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-divider">
                  <td className="py-2 pr-4 font-mono text-xs">{r.acknowledgedDate}</td>
                  <td className="py-2 pr-4">{r.driverName}</td>
                  <td className="py-2 pr-4">{r.briefingTitle}</td>
                  <td className="py-2 pr-4 text-xs text-text-secondary-on-dark">
                    {r.messageReadAt ? new Date(r.messageReadAt).toLocaleString() : '—'}
                  </td>
                  <td className="py-2 pr-4 text-xs text-text-secondary-on-dark">
                    {r.videoCompletedAt ? new Date(r.videoCompletedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
