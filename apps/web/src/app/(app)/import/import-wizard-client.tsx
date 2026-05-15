'use client';

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useCallback, useState } from 'react';

type Mode = 'dry_run' | 'live';
type Phase = 'idle' | 'uploading' | 'running' | 'completed' | 'failed' | 'cancelled';

interface TotalsRow {
  created: number;
  updated: number;
  skippedDedup: number;
  errored: number;
}
interface RunResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  totals: Record<string, TotalsRow | undefined>;
  message?: string;
}

const RECORD_TYPES: { key: string; label: string }[] = [
  { key: 'customers', label: 'Customers' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'trucks', label: 'Trucks' },
  { key: 'jobs', label: 'Jobs / Calls' },
  { key: 'impounds', label: 'Impounds' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'payments', label: 'Payments' },
  { key: 'motor_club_history', label: 'Motor Club History' },
  { key: 'attachments', label: 'Attachments' },
];

export function ImportWizardClient({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f?.name.toLowerCase().endsWith('.zip')) {
      setFile(f);
      setResult(null);
      setError(null);
    } else {
      setError('Drop a .zip file');
    }
  }, []);

  const start = useCallback(
    async (mode: Mode) => {
      if (!file) return;
      setPhase('uploading');
      setUploadPct(0);
      setError(null);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/import/runs?mode=${mode}&tenantId=${tenantId}`);
      xhr.setRequestHeader('content-type', 'application/zip');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setUploadPct(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 2) setPhase('running');
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const json: RunResult = JSON.parse(xhr.responseText);
              setResult(json);
              setPhase(json.status);
            } catch (e) {
              setError('Could not parse response');
              setPhase('failed');
            }
          } else {
            setError(`HTTP ${xhr.status}: ${xhr.responseText}`);
            setPhase('failed');
          }
        }
      };
      xhr.onerror = () => {
        setError('Network error during upload');
        setPhase('failed');
      };
      xhr.send(file);
    },
    [file, tenantId],
  );

  const cancelRun = useCallback(async () => {
    if (!result?.runId) return;
    await fetch(`/api/import/runs/${result.runId}/cancel`, { method: 'POST' });
  }, [result?.runId]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">1. Target tenant</h2>
        <p className="text-sm text-text-secondary-on-dark">
          Importing into <strong>{tenantName}</strong> (tenant {tenantId}).
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">2. Upload bundle</h2>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="flex h-40 cursor-pointer items-center justify-center rounded border-2 border-dashed border-border bg-background"
        >
          {file ? (
            <div className="text-center">
              <p className="font-medium">{file.name}</p>
              <p className="text-xs text-text-secondary-on-dark">
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
          ) : (
            <div className="text-center text-text-secondary-on-dark">
              <p>Drop a Towbook export ZIP here</p>
              <p className="text-xs">Max 2 GiB. Includes CSVs + media/ subfolder.</p>
            </div>
          )}
        </div>
        <label htmlFor="import-file" className="sr-only">
          Towbook export bundle (ZIP)
        </label>
        <input
          id="import-file"
          type="file"
          accept=".zip,application/zip"
          className="mt-2 block w-full"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {error && (
          <p role="alert" aria-live="assertive" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">3. Dry run, then live</h2>
        <p className="text-sm text-text-secondary-on-dark">
          Dry-run rolls back at the end so you can see what would happen without persisting changes.
          Live commits the bundle.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => start('dry_run')}
            disabled={!file || phase === 'uploading' || phase === 'running'}
          >
            Dry-run
          </Button>
          <Button
            onClick={() => start('live')}
            disabled={!file || phase === 'uploading' || phase === 'running'}
          >
            Live import
          </Button>
          {phase === 'running' && (
            <Button onClick={cancelRun} variant="outline">
              Cancel
            </Button>
          )}
          <Link href="/import/reconcile" className="ml-auto text-sm underline">
            Reconciliation →
          </Link>
        </div>
        {(phase === 'uploading' || phase === 'running') && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded bg-background">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${phase === 'uploading' ? uploadPct : 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-text-secondary-on-dark">
              {phase === 'uploading' ? `Uploading ${uploadPct}%` : 'Running on server…'}
            </p>
          </div>
        )}
      </section>

      {result && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">
            4. {phase === 'completed' ? 'Completed' : phase === 'failed' ? 'Failed' : 'Cancelled'}
          </h2>
          {result.message && (
            <p className="text-sm text-text-secondary-on-dark">{result.message}</p>
          )}
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2">Type</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Deduped</th>
                <th>Errored</th>
              </tr>
            </thead>
            <tbody>
              {RECORD_TYPES.map((rt) => {
                const t = result.totals[rt.key];
                return (
                  <tr key={rt.key} className="border-b border-border">
                    <td className="py-2">{rt.label}</td>
                    <td>{t?.created ?? 0}</td>
                    <td>{t?.updated ?? 0}</td>
                    <td>{t?.skippedDedup ?? 0}</td>
                    <td className={(t?.errored ?? 0) > 0 ? 'text-destructive' : ''}>
                      {t?.errored ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-4 flex gap-2">
            <Link
              href={`/api/import/runs/${result.runId}/events?action=error`}
              className="text-sm underline"
            >
              Download errors
            </Link>
            <Link href={`/api/import/runs/${result.runId}/events`} className="text-sm underline">
              Full event log
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
