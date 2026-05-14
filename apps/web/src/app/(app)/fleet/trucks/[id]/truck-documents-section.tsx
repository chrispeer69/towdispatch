'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type DocumentDto, documentTypeValues } from '@ustowdispatch/shared';
import { type ChangeEvent, useState } from 'react';

interface Props {
  truckId: string;
  initialDocs: DocumentDto[];
}

export function TruckDocumentsSection({ truckId, initialDocs }: Props): JSX.Element {
  const [docs, setDocs] = useState<DocumentDto[]>(initialDocs);
  const [docType, setDocType] = useState<string>('registration');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpload(): Promise<void> {
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const contentBase64 = bufferToBase64(buf);
      const res = await fetch('/api/fleet/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'truck',
          ownerId: truckId,
          docType,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64,
          ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T00:00:00Z`).toISOString() } : {}),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(j?.message ?? 'Upload failed.');
        return;
      }
      const created = (await res.json()) as DocumentDto;
      setDocs((prev) => [created, ...prev]);
      setFile(null);
      setExpiresAt('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="truck-documents-section">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
        Documents
      </h3>
      <div className="mt-3 grid gap-3 rounded-[12px] border border-steel-border bg-steel-mid p-4 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label>Type</Label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="rounded-[8px] border border-steel-border bg-steel px-3 py-2 text-sm"
          >
            {documentTypeValues.map((d) => (
              <option key={d} value={d}>
                {d.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Expires</Label>
          <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>File</Label>
          <input
            type="file"
            data-testid="document-file-input"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-text-secondary"
          />
        </div>
        <div className="md:col-span-3">
          <Button
            type="button"
            onClick={() => void onUpload()}
            disabled={busy}
            data-testid="document-upload-button"
          >
            Upload document
          </Button>
          {error ? <span className="ml-3 text-sm text-red-400">{error}</span> : null}
        </div>
      </div>

      {docs.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No documents on file.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm" data-testid="truck-documents-list">
          {docs.map((d) => (
            <li key={d.id} className="flex justify-between">
              <span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  {d.docType}
                </span>{' '}
                {d.fileName}
              </span>
              <span className="font-mono text-xs text-text-muted">
                {d.expiresAt ? `exp ${d.expiresAt.slice(0, 10)}` : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i] as number);
  return globalThis.btoa(binary);
}
