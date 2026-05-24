'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteSavedButton({ id }: { id: string }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = async (): Promise<void> => {
    if (!confirm('Delete this saved report?')) return;
    setBusy(true);
    try {
      await fetch(`/api/reporting/saved/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md border border-steel-border bg-steel-mid px-2 py-1 text-xs text-text-secondary hover:bg-steel-light hover:text-danger disabled:opacity-60"
    >
      {busy ? '…' : 'Delete'}
    </button>
  );
}
