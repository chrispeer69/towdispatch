'use client';

import type { ReportId } from '@towcommand/shared';
import { useState } from 'react';

/**
 * ExportButtons — CSV + PDF triggers. The browser hits the BFF, which calls
 * the API, which renders, persists, and returns a relative file URL. We open
 * that URL in a new tab so the browser handles the download.
 *
 * Save dialog uses the same pattern but POSTs to /api/reporting/saved.
 */
export function ExportButtons({
  reportId,
  filters,
}: {
  reportId: ReportId;
  filters: Record<string, string>;
}): JSX.Element {
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onExport = async (format: 'csv' | 'pdf'): Promise<void> => {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(`/api/reporting/${reportId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format, filters }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Export failed (${res.status})`);
      }
      const data = (await res.json()) as { url: string; filename: string };
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onExport('csv')}
          className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-sm text-text-primary hover:bg-steel-light disabled:opacity-60"
        >
          {busy === 'csv' ? 'CSV…' : 'CSV'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onExport('pdf')}
          className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-sm text-text-primary hover:bg-steel-light disabled:opacity-60"
        >
          {busy === 'pdf' ? 'PDF…' : 'PDF'}
        </button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
