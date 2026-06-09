'use client';
/**
 * Inline status pill that shows the customer-tracking SMS state for an
 * active job — and pops a small modal with the message thread + resend +
 * revoke controls when clicked. Lives next to the active job card on the
 * dispatch board.
 */
import { type TrackingLinkDto, type TrackingMessageDto } from '@towdispatch/shared';
import { type JSX, useEffect, useState } from 'react';

interface Props {
  jobId: string;
  jobNumber: string;
  canRevoke: boolean;
}

const STATUS_LABELS: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' | 'neutral' }> = {
  pending: { label: 'Sending…', tone: 'warn' },
  queued: { label: 'Sending…', tone: 'warn' },
  sent: { label: 'Sent ✓', tone: 'ok' },
  delivered: { label: 'Delivered ✓', tone: 'ok' },
  failed: { label: 'Failed', tone: 'err' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export function TrackingBadge({ jobId, jobNumber, canRevoke }: Props): JSX.Element {
  const [link, setLink] = useState<TrackingLinkDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tracking/${jobId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { link: null }))
      .then((data: { link: TrackingLinkDto | null }) => {
        if (!cancelled) setLink(data.link);
      })
      .catch(() => {
        // silently ignore — badge is optional UI
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!link) return <span className="text-[10px] text-text-secondary-on-dark">—</span>;

  const meta = STATUS_LABELS[link.smsStatus] ?? { label: link.smsStatus, tone: 'neutral' };
  const tone =
    meta.tone === 'ok'
      ? 'bg-ok/15 text-ok'
      : meta.tone === 'warn'
        ? 'bg-brand-primary/15 text-brand-primary'
        : meta.tone === 'err'
          ? 'bg-danger/15 text-danger'
          : 'bg-bg-surface text-text-secondary-on-dark';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
        data-testid={`tracking-badge-${jobId}`}
      >
        {link.viewCount > 0 ? 'Viewed ✓' : meta.label}
      </button>
      {open ? (
        <TrackingModal
          jobId={jobId}
          jobNumber={jobNumber}
          link={link}
          canRevoke={canRevoke}
          onClose={() => setOpen(false)}
          onLinkChange={setLink}
        />
      ) : null}
    </>
  );
}

function TrackingModal({
  jobId,
  jobNumber,
  link,
  canRevoke,
  onClose,
  onLinkChange,
}: {
  jobId: string;
  jobNumber: string;
  link: TrackingLinkDto;
  canRevoke: boolean;
  onClose: () => void;
  onLinkChange: (l: TrackingLinkDto | null) => void;
}): JSX.Element {
  const [messages, setMessages] = useState<TrackingMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/tracking/${jobId}/messages`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages: TrackingMessageDto[] }) => setMessages(data.messages))
      .catch(() => {
        /* ignore */
      });
  }, [jobId]);

  async function send(): Promise<void> {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tracking/${jobId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const m = (await res.json()) as TrackingMessageDto;
        setMessages((prev) => [...prev, m]);
        setDraft('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/tracking/${jobId}/resend`, { method: 'POST' });
      if (res.ok) {
        const updated = (await res.json()) as TrackingLinkDto;
        onLinkChange(updated);
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    if (!confirm('Revoke the customer tracking link? They will see "expired" on the page.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tracking/${jobId}/revoke`, { method: 'POST' });
      if (res.ok) {
        onLinkChange(null);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      // biome-ignore lint/a11y/useSemanticElements: <dialog>.showModal() doesn't fit a React-controlled open state.
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-bg-base rounded-lg p-5 max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-condensed text-lg font-extrabold uppercase">
              Tracking — #{jobNumber}
            </h3>
            <p className="text-xs text-text-secondary-on-dark mt-0.5">
              SMS to {link.smsToPhone ?? '—'} · status {link.smsStatus}
              {link.viewCount > 0 ? ` · viewed ${link.viewCount}× ` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary-on-dark hover:text-text-primary-on-dark"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="rounded-md bg-bg-surface-elevated px-3 py-2 mb-3 break-all text-xs">
          <span className="text-text-secondary-on-dark">URL: </span>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">
            {link.url}
          </a>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto mb-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-sm rounded-md px-3 py-2 max-w-[85%] ${
                m.direction === 'outbound'
                  ? 'ml-auto bg-brand-primary/15'
                  : m.direction === 'system'
                    ? 'bg-bg-surface'
                    : 'bg-bg-surface-elevated'
              }`}
            >
              <div>{m.body}</div>
              <div className="text-text-secondary-on-dark text-[10px] mt-1">
                {new Date(m.createdAt).toLocaleTimeString()}
              </div>
            </div>
          ))}
          {messages.length === 0 ? (
            <div className="text-xs text-text-secondary-on-dark">No messages yet.</div>
          ) : null}
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void send();
            }}
            className="flex-1 bg-bg-surface-elevated rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            placeholder="Reply to customer…"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-steel disabled:opacity-50"
          >
            Send
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => void resend()}
            disabled={busy}
            className="rounded-md bg-bg-surface-elevated px-3 py-1.5 hover:bg-bg-surface disabled:opacity-50"
          >
            Resend SMS
          </button>
          {canRevoke ? (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy}
              className="rounded-md bg-danger/20 px-3 py-1.5 text-danger hover:bg-danger/30 disabled:opacity-50"
            >
              Revoke link
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
