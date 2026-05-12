'use client';

import { Button } from '@/components/ui/button';
import { useCallback, useState } from 'react';

interface Diff {
  recordType: string;
  missing: { externalId: string; identifier: string }[];
  orphaned: { externalId: string; towcommandId: string; identifier: string }[];
  drift: {
    externalId: string;
    towcommandId: string;
    fields: { field: string; bundle: string | null; db: string | null }[];
  }[];
}

export function ReconcileClient({ tenantId }: { tenantId: string }): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [diffs, setDiffs] = useState<Diff[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`/api/import/reconcile?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: buf,
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${await res.text()}`);
      } else {
        const json = (await res.json()) as { diffs: Diff[] };
        setDiffs(json.diffs);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [file, tenantId]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">Drop a Towbook export</h2>
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full"
        />
        <Button onClick={run} disabled={!file || busy} className="mt-4">
          {busy ? 'Reconciling…' : 'Run reconciliation'}
        </Button>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </section>

      {diffs && (
        <section className="space-y-4">
          {diffs.map((d) => (
            <div key={d.recordType} className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold capitalize">{d.recordType.replace('_', ' ')}</h3>
              <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                <Counter label="Missing" value={d.missing.length} tone="destructive" />
                <Counter label="Orphaned" value={d.orphaned.length} tone="warning" />
                <Counter label="Drift" value={d.drift.length} tone="warning" />
              </div>
              {d.missing.length > 0 && (
                <Bucket
                  title="Missing (in Towbook, not in TowCommand)"
                  items={d.missing.map((m) => `${m.identifier} (${m.externalId})`)}
                />
              )}
              {d.orphaned.length > 0 && (
                <Bucket
                  title="Orphaned (in TowCommand, not in this export)"
                  items={d.orphaned.map((m) => `${m.identifier} (${m.externalId})`)}
                />
              )}
              {d.drift.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium">Drift</p>
                  <ul className="mt-2 space-y-2 text-xs">
                    {d.drift.slice(0, 20).map((dd) => (
                      <li key={dd.externalId} className="border-l-2 border-border pl-2">
                        <p className="font-mono">{dd.externalId}</p>
                        {dd.fields.map((f) => (
                          <p key={f.field}>
                            <span className="font-medium">{f.field}:</span> bundle=
                            <code>{f.bundle ?? 'null'}</code> · db=<code>{f.db ?? 'null'}</code>
                          </p>
                        ))}
                      </li>
                    ))}
                    {d.drift.length > 20 && (
                      <li className="text-text-secondary">… and {d.drift.length - 20} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: { label: string; value: number; tone: 'destructive' | 'warning' | 'success' }) {
  const toneClass =
    value === 0 ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-warning';
  return (
    <div className="rounded border border-border bg-background p-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Bucket({ title, items }: { title: string; items: string[] }): JSX.Element {
  const head = items.slice(0, 20);
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 list-disc pl-5 text-xs text-text-secondary">
        {head.map((i) => (
          <li key={i}>{i}</li>
        ))}
        {items.length > 20 && <li>… and {items.length - 20} more</li>}
      </ul>
    </div>
  );
}
