'use client';

/**
 * Operator-console evidence grid for a job. Renders a thumbnail tile per
 * uploaded photo / video / signature / document, opens a focus-trapped
 * lightbox on click (Dialog handles Escape + body-scroll lock + aria-modal),
 * and — for owner/admin only — exposes a soft-delete behind a confirm step.
 *
 * Thumbnails come from the API's short-lived presigned `thumbnailUrl`; if a
 * tile has none yet (generation lag) or it 404s, we fall back to the
 * full-size `downloadUrl`, then to a type icon. Delete goes through the BFF
 * route handler so the operator cookie is attached server-side.
 */
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { JobEvidenceKind, JobEvidenceWithUrlDto } from '@ustowdispatch/shared';
import { ChevronLeft, ChevronRight, FileText, ImageOff, Play, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useState } from 'react';

const KIND_LABEL: Record<JobEvidenceKind, string> = {
  photo_pickup: 'Pickup photo',
  photo_dropoff: 'Drop-off photo',
  photo_damage: 'Damage photo',
  photo_hookup: 'Hookup photo',
  photo_release: 'Release photo',
  photo_other: 'Photo',
  video_walkaround: 'Walkaround video',
  video_other: 'Video',
  signature_customer: 'Customer signature',
  signature_driver: 'Driver signature',
  document_scan: 'Document',
  other: 'Attachment',
};

function isVideo(kind: JobEvidenceKind): boolean {
  return kind.startsWith('video_');
}

function isViewableImage(kind: JobEvidenceKind): boolean {
  return kind.startsWith('photo_') || kind.startsWith('signature_');
}

function formatCaptured(item: JobEvidenceWithUrlDto): string {
  const iso = item.capturedAt ?? item.uploadedAt ?? item.createdAt;
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface Props {
  jobId: string;
  items: JobEvidenceWithUrlDto[];
  canDelete: boolean;
}

export function EvidenceGrid({ jobId: _jobId, items: initial, canDelete }: Props): JSX.Element {
  const router = useRouter();
  const [items, setItems] = useState<JobEvidenceWithUrlDto[]>(initial);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync after a router.refresh re-renders this client
  // component with fresh server props.
  useEffect(() => {
    setItems(initial);
  }, [initial]);

  const showPrev = useCallback(() => {
    setActiveIndex((i) => (i === null ? i : (i - 1 + items.length) % items.length));
  }, [items.length]);
  const showNext = useCallback(() => {
    setActiveIndex((i) => (i === null ? i : (i + 1) % items.length));
  }, [items.length]);

  // Arrow-key navigation while the lightbox is open. (Escape is handled by
  // the Dialog primitive itself.)
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, showPrev, showNext]);

  async function onDelete(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/job-evidence/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `Delete failed (${res.status}).`);
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
      setConfirmId(null);
      setActiveIndex(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div
        className="flex h-32 flex-col items-center justify-center rounded-[14px] border border-dashed border-divider bg-bg-surface/40 text-center"
        data-testid="evidence-empty"
      >
        <p className="text-sm text-text-secondary-on-dark">
          No evidence uploaded for this job yet.
        </p>
      </div>
    );
  }

  const active = activeIndex === null ? null : (items[activeIndex] ?? null);

  return (
    <>
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        data-testid="evidence-grid"
      >
        {items.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setActiveIndex(i)}
              className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[12px] border border-divider bg-bg-surface-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              aria-label={`${KIND_LABEL[item.kind]} — ${formatCaptured(item)}. Open preview.`}
              data-testid="evidence-tile"
            >
              <EvidenceThumb item={item} />
              {isVideo(item.kind) ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Play className="h-8 w-8 text-white drop-shadow" aria-hidden />
                </span>
              ) : null}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-left text-[11px] font-medium text-white">
                {KIND_LABEL[item.kind]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={active !== null} onOpenChange={(o) => !o && setActiveIndex(null)}>
        {active ? (
          <DialogContent className="sm:max-w-3xl" onClose={() => setActiveIndex(null)}>
            <DialogHeader>
              <DialogTitle>{KIND_LABEL[active.kind]}</DialogTitle>
              <DialogDescription>Captured {formatCaptured(active)}</DialogDescription>
            </DialogHeader>

            <div className="relative flex min-h-[40vh] items-center justify-center rounded-[12px] bg-black/40">
              <EvidenceFull item={active} />
              {items.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={showPrev}
                    aria-label="Previous evidence"
                    className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronLeft className="h-6 w-6" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={showNext}
                    aria-label="Next evidence"
                    className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronRight className="h-6 w-6" aria-hidden />
                  </button>
                </>
              ) : null}
            </div>

            {canDelete ? (
              <DialogFooter>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmId(active.id)}
                  disabled={busy}
                  data-testid="evidence-delete"
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Delete
                </Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && !busy && setConfirmId(null)}>
        {confirmId !== null ? (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this evidence?</DialogTitle>
              <DialogDescription>
                This removes it from the job record. This action is audited and cannot be undone
                from here.
              </DialogDescription>
            </DialogHeader>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmId(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => onDelete(confirmId)}
                disabled={busy}
                data-testid="evidence-delete-confirm"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function EvidenceThumb({ item }: { item: JobEvidenceWithUrlDto }): JSX.Element {
  const src = item.thumbnailUrl ?? item.downloadUrl;
  if (item.uploadStatus !== 'uploaded' || !src) {
    return <StatusPlaceholder item={item} />;
  }
  if (isVideo(item.kind) || isViewableImage(item.kind)) {
    return (
      <img
        src={src}
        alt={KIND_LABEL[item.kind]}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    );
  }
  return <StatusPlaceholder item={item} />;
}

function StatusPlaceholder({ item }: { item: JobEvidenceWithUrlDto }): JSX.Element {
  const Icon = item.kind === 'document_scan' ? FileText : ImageOff;
  const label =
    item.uploadStatus === 'pending'
      ? 'Uploading…'
      : item.uploadStatus === 'failed'
        ? 'Upload failed'
        : KIND_LABEL[item.kind];
  return (
    <span className="flex flex-col items-center gap-1 px-2 text-center text-text-secondary-on-dark">
      <Icon className="h-7 w-7" aria-hidden />
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

function EvidenceFull({ item }: { item: JobEvidenceWithUrlDto }): JSX.Element {
  if (!item.downloadUrl) {
    return <p className="p-8 text-sm text-text-secondary-on-dark">Preview unavailable.</p>;
  }
  if (isVideo(item.kind)) {
    // biome-ignore lint/a11y/useMediaCaption: field-captured evidence has no caption track
    return <video src={item.downloadUrl} controls className="max-h-[70vh] w-full" />;
  }
  if (isViewableImage(item.kind)) {
    return (
      <img
        src={item.downloadUrl}
        alt={KIND_LABEL[item.kind]}
        className="max-h-[70vh] w-full object-contain"
      />
    );
  }
  return (
    <a
      href={item.downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-[10px] border border-divider px-4 py-3 text-sm font-semibold text-brand-primary hover:underline"
    >
      <FileText className="h-5 w-5" aria-hidden /> Open {KIND_LABEL[item.kind].toLowerCase()}
    </a>
  );
}
