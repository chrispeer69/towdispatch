'use client';

/**
 * Tabbed admin view. Each tab keeps the initial server-rendered data and
 * uses the BFF for mutations. Recharts intentionally NOT pulled in here —
 * Session 14 owns the Recharts wiring; in this v1 we render the metrics
 * as a static table with sparkline-style bars. When Session 14 merges,
 * the metrics block can be lifted to its dashboard primitives in a
 * follow-up.
 */
import {
  clientCreateWebhook,
  clientDeleteWebhook,
  clientPreviewTemplate,
  clientRetryDeadLetter,
  clientRotateWebhook,
  clientUpsertTemplate,
} from '@/lib/api/notifications';
import type {
  DeadLetterDto,
  DeliveryMetrics,
  NotificationChannel,
  NotificationTemplateDto,
  WebhookSubscriptionDto,
} from '@ustowdispatch/shared';
import { useState } from 'react';

type Tab = 'metrics' | 'dlq' | 'templates' | 'webhooks';

export function AdminNotificationsView({
  initialMetrics,
  initialDeadLetters,
  initialTemplates,
  initialWebhooks,
}: {
  initialMetrics: DeliveryMetrics;
  initialDeadLetters: DeadLetterDto[];
  initialTemplates: NotificationTemplateDto[];
  initialWebhooks: WebhookSubscriptionDto[];
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('metrics');
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-steel-border">
        {(['metrics', 'dlq', 'templates', 'webhooks'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              tab === t
                ? 'border-b-2 border-orange text-orange'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'dlq' ? 'Dead letters' : t}
          </button>
        ))}
      </div>
      {tab === 'metrics' && <MetricsBlock metrics={initialMetrics} />}
      {tab === 'dlq' && <DeadLettersBlock items={initialDeadLetters} />}
      {tab === 'templates' && <TemplatesBlock items={initialTemplates} />}
      {tab === 'webhooks' && <WebhooksBlock items={initialWebhooks} />}
    </div>
  );
}

function MetricsBlock({ metrics }: { metrics: DeliveryMetrics }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-6">
        <Tile label="Sent" value={metrics.totals.sent} />
        <Tile label="Delivered" value={metrics.totals.delivered} />
        <Tile label="Failed" value={metrics.totals.failed} />
        <Tile label="Bounced" value={metrics.totals.bounced} />
        <Tile label="Suppressed" value={metrics.totals.suppressed} />
        <Tile label="Dead letters" value={metrics.totals.deadLettered} />
      </div>
      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="metrics-table">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Channel</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wider text-text-muted">Sent</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wider text-text-muted">Delivered</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wider text-text-muted">Failed</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wider text-text-muted">Bounced</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wider text-text-muted">Suppressed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {metrics.buckets.map((b) => (
              <tr key={b.channel}>
                <td className="px-3 py-2 text-sm">{b.channel}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{b.sent}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{b.delivered}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{b.failed}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{b.bounced}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{b.suppressed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-lg border border-steel-border bg-steel-mid/40 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-1 font-condensed text-2xl font-extrabold">{value}</div>
    </div>
  );
}

function DeadLettersBlock({ items }: { items: DeadLetterDto[] }): JSX.Element {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function onRetry(id: string): Promise<void> {
    setRetrying(id);
    setMsg(null);
    try {
      await clientRetryDeadLetter(id);
      setMsg(`Retried ${id} — dispatched.`);
    } catch (e) {
      setMsg(`Retry failed: ${(e as Error).message}`);
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <div className="rounded-md border border-orange/40 bg-orange/10 px-3 py-2 text-xs">{msg}</div>}
      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="dlq-table">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Created</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Channel</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Reason</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Attempts</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Retried</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-text-muted">
                  No dead letters. Good.
                </td>
              </tr>
            )}
            {items.map((d) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-text-muted">
                  {new Date(d.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs">{d.channel}</td>
                <td className="px-3 py-2 text-xs">{d.failureReason}</td>
                <td className="px-3 py-2 text-xs">{d.attemptCount}</td>
                <td className="px-3 py-2 text-xs">{d.retriedAt ? '✓' : '—'}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void onRetry(d.id)}
                    disabled={retrying === d.id || !!d.retriedAt}
                    className="rounded-md bg-orange px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-orange-light disabled:opacity-40"
                  >
                    {retrying === d.id ? '…' : 'Retry'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplatesBlock({ items }: { items: NotificationTemplateDto[] }): JSX.Element {
  const [editing, setEditing] = useState<NotificationTemplateDto | null>(null);
  const [body, setBody] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openEdit(t: NotificationTemplateDto): void {
    setEditing(t);
    setBody(t.body);
    setSubject(t.subject ?? '');
    setPreview(null);
    setError(null);
  }

  async function onPreview(): Promise<void> {
    if (!editing) return;
    setError(null);
    try {
      const samplePayload: Record<string, unknown> = {};
      for (const v of editing.variablesSchema as Array<{ key: string; example: unknown }>) {
        samplePayload[v.key] = v.example;
      }
      const result = await clientPreviewTemplate({
        templateKey: editing.templateKey,
        channel: editing.channel,
        payload: samplePayload,
      });
      setPreview(`${result.subject ? `Subject: ${result.subject}\n\n` : ''}${result.body}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSave(): Promise<void> {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await clientUpsertTemplate({
        templateKey: editing.templateKey,
        channel: editing.channel,
        subject: subject || null,
        body,
      });
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="templates-table">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Key</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Channel</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {items.map((t) => (
              <tr
                key={`${t.templateKey}-${t.channel}`}
                onClick={() => openEdit(t)}
                className="cursor-pointer transition-colors hover:bg-steel-light/20"
              >
                <td className="px-3 py-2 text-xs">{t.templateKey}</td>
                <td className="px-3 py-2 text-xs">{t.channel}</td>
                <td className="px-3 py-2 text-xs">{t.isOverride ? 'Tenant' : 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-steel-border bg-steel-mid/30 p-4">
        {editing ? (
          <div className="space-y-3">
            <h3 className="font-condensed text-sm font-extrabold uppercase tracking-wider">
              {editing.templateKey} / {editing.channel}
            </h3>
            <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
              Subject
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
              />
            </label>
            <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
              Body (Handlebars)
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 font-mono text-xs text-text-primary"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onPreview()}
                className="rounded-md border border-steel-border bg-steel-light/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary hover:text-orange"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={saving}
                className="rounded-md bg-orange px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-light disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save override'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            {preview && (
              <pre className="max-h-[300px] overflow-auto rounded-md border border-steel-border bg-steel p-3 text-[11px] text-text-primary">
                {preview}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted">Select a template to edit its tenant override.</p>
        )}
      </div>
    </div>
  );
}

function WebhooksBlock({ items }: { items: WebhookSubscriptionDto[] }): JSX.Element {
  const [list, setList] = useState(items);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('*');
  const [creating, setCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(): Promise<void> {
    setError(null);
    setCreating(true);
    try {
      const sub = await clientCreateWebhook({
        name,
        endpointUrl: url,
        eventTypes: events.split(',').map((s) => s.trim()).filter(Boolean),
        active: true,
      });
      setList((cur) => [sub, ...cur]);
      setRevealedSecret(sub.secret);
      setName('');
      setUrl('');
      setEvents('*');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function onRotate(id: string): Promise<void> {
    const sub = await clientRotateWebhook(id);
    setRevealedSecret(sub.secret);
    setList((cur) => cur.map((s) => (s.id === id ? { ...s, lastSuccessAt: sub.lastSuccessAt } : s)));
  }

  async function onDelete(id: string): Promise<void> {
    if (!window.confirm('Delete webhook subscription?')) return;
    await clientDeleteWebhook(id);
    setList((cur) => cur.filter((s) => s.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-steel-border bg-steel-mid/30 p-4">
        <h3 className="mb-2 font-condensed text-sm font-extrabold uppercase tracking-wider">
          New webhook
        </h3>
        <div className="grid gap-2 md:grid-cols-4">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
          />
          <input
            type="url"
            placeholder="https://example.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary md:col-span-2"
          />
          <input
            type="text"
            placeholder="Event types (* or comma sep)"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            className="rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={creating || !name || !url}
          className="mt-2 rounded-md bg-orange px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-light disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {revealedSecret && (
          <div className="mt-3 rounded-md border border-orange/40 bg-orange/10 px-3 py-2 text-xs">
            <strong className="block">Save this secret — it will not be shown again:</strong>
            <code className="mt-1 block font-mono">{revealedSecret}</code>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="webhooks-table">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Name</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">URL</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Events</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Last success</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-text-muted">
                  No webhook subscriptions yet.
                </td>
              </tr>
            )}
            {list.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 text-xs">{s.name}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{s.endpointUrl}</td>
                <td className="px-3 py-2 text-xs">{s.eventTypes.join(', ')}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-text-muted">
                  {s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void onRotate(s.id)}
                      className="rounded-md border border-steel-border bg-steel-light/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary hover:text-orange"
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(s.id)}
                      className="rounded-md border border-red-700/50 bg-red-900/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-200 hover:bg-red-900/50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
