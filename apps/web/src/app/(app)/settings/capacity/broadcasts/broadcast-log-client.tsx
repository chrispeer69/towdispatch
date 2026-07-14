'use client';

/**
 * Broadcast log table — client side of /settings/capacity/broadcasts.
 * Filters (partner, status) and pagination refetch through the
 * /api/capacity BFF; a row expander pretty-prints the exact JSON payload
 * that went out to the partner.
 */
import { CapacityModal } from '@/components/capacity/capacity-shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { clientListCapacityBroadcasts } from '@/lib/api/capacity-client';
import { cn } from '@/lib/utils';
import {
  CAPACITY_BROADCAST_STATUSES,
  type CapacityBroadcastDto,
  type CapacityBroadcastPage,
  type CapacityBroadcastStatus,
  type CapacityPartnerDto,
} from '@ustowdispatch/shared';
import { FileJson, Loader2 } from 'lucide-react';
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// TODO(i18n): broadcast-log strings are English-only today, matching the
// rest of /settings; add es parity when the surface migrates to next-intl.

const PER_PAGE = 25;

const STATUS_LABEL: Record<CapacityBroadcastStatus, string> = {
  pending: 'Pending',
  delivered: 'Delivered',
  failed: 'Failed',
  dead_letter: 'Dead letter',
};

const STATUS_TONE: Record<CapacityBroadcastStatus, string> = {
  pending: 'bg-warn/15 text-warn',
  delivered: 'bg-ok/15 text-ok',
  failed: 'bg-danger/15 text-danger',
  dead_letter: 'bg-bg-surface-elevated text-text-secondary-on-dark',
};

interface Props {
  initialPage: CapacityBroadcastPage;
  partners: CapacityPartnerDto[];
}

export function BroadcastLogClient({ initialPage, partners }: Props): JSX.Element {
  const [data, setData] = useState<CapacityBroadcastPage>(initialPage);
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(initialPage.page);
  const [loading, setLoading] = useState(false);
  const [payloadFor, setPayloadFor] = useState<CapacityBroadcastDto | null>(null);
  // Skip the initial-mount fetch — the server already rendered page 1.
  const firstRender = useRef(true);

  const load = useCallback(
    async (nextPage: number, nextPartnerId: string, nextStatus: string): Promise<void> => {
      setLoading(true);
      try {
        const result = await clientListCapacityBroadcasts({
          page: nextPage,
          perPage: PER_PAGE,
          ...(nextPartnerId ? { partnerId: nextPartnerId } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
        });
        setData(result);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load broadcasts');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load(page, partnerId, status);
  }, [page, partnerId, status, load]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="bl-partner">Partner</Label>
          <select
            id="bl-partner"
            value={partnerId}
            onChange={(e) => {
              setPartnerId(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-[10px] border border-divider bg-bg-surface px-2 text-sm text-text-primary-on-dark"
          >
            <option value="">All partners</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bl-status">Status</Label>
          <select
            id="bl-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-[10px] border border-divider bg-bg-surface px-2 text-sm text-text-primary-on-dark"
          >
            <option value="">All statuses</option>
            {CAPACITY_BROADCAST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <span className="flex items-center gap-2 pb-2 text-xs text-text-secondary-on-dark">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>Created</Th>
              <Th>Partner</Th>
              <Th>Status</Th>
              <Th>HTTP</Th>
              <Th>Latency</Th>
              <Th>Retries</Th>
              <Th>Delivered at</Th>
              <Th>Last error</Th>
              <Th align="right">Payload</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {data.items.map((b) => (
              <tr key={b.id} className="hover:bg-bg-surface-elevated/30">
                <td className="whitespace-nowrap px-4 py-2 align-middle text-text-secondary-on-dark">
                  {new Date(b.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 align-middle font-medium text-text-primary-on-dark">
                  {b.partnerName}
                </td>
                <td className="px-4 py-2 align-middle">
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]',
                      STATUS_TONE[b.status],
                    )}
                  >
                    {STATUS_LABEL[b.status]}
                  </span>
                </td>
                <td className="px-4 py-2 align-middle text-text-secondary-on-dark">
                  {b.httpStatus ?? '—'}
                </td>
                <td className="px-4 py-2 align-middle font-mono text-xs text-text-secondary-on-dark">
                  {b.latencyMs !== null ? `${b.latencyMs} ms` : '—'}
                </td>
                <td className="px-4 py-2 align-middle text-text-secondary-on-dark">
                  {b.retryCount}
                </td>
                <td className="whitespace-nowrap px-4 py-2 align-middle text-text-secondary-on-dark">
                  {b.deliveredAt ? new Date(b.deliveredAt).toLocaleString() : '—'}
                </td>
                <td
                  className="max-w-[180px] truncate px-4 py-2 align-middle text-xs text-danger"
                  title={b.lastError ?? undefined}
                >
                  {b.lastError ?? '—'}
                </td>
                <td className="px-4 py-2 align-middle text-right">
                  <button
                    type="button"
                    onClick={() => setPayloadFor(b)}
                    aria-label={`View payload sent to ${b.partnerName}`}
                    className="inline-flex items-center gap-1 rounded-md border border-divider px-2 py-1 text-xs font-semibold text-text-secondary-on-dark hover:border-divider-strong"
                  >
                    <FileJson className="h-3.5 w-3.5" /> View
                  </button>
                </td>
              </tr>
            ))}
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-text-secondary-on-dark">
                  No broadcasts match these filters yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary-on-dark">
          {data.total} {data.total === 1 ? 'broadcast' : 'broadcasts'} · page {data.page} of{' '}
          {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {payloadFor ? (
        <CapacityModal
          titleId="broadcast-payload-title"
          title={`Payload — ${payloadFor.partnerName}`}
          onClose={() => setPayloadFor(null)}
          wide
        >
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
            Sent {new Date(payloadFor.createdAt).toLocaleString()}
          </p>
          <pre className="max-h-[60vh] overflow-auto rounded-[10px] border border-divider bg-bg-base p-3 font-mono text-xs text-text-primary-on-dark">
            {JSON.stringify(payloadFor.payload, null, 2)}
          </pre>
        </CapacityModal>
      ) : null}
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}): JSX.Element {
  return (
    <th
      className={cn(
        'px-4 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}
