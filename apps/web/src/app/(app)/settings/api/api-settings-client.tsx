'use client';

/**
 * /settings/api — API keys & webhooks admin client.
 *
 * Two sections against /public-api/* CRUD:
 *   - API keys: list, create (full key revealed ONCE), revoke.
 *   - Webhooks: list, create (signing secret revealed ONCE), toggle active,
 *     delete, test-send, and a per-endpoint delivery log with retry.
 *
 * Secrets returned at creation are shown once in a reveal panel with a copy
 * button; they are never re-fetchable. Modals use the native <dialog> element
 * so the browser supplies focus trap, Escape, and the backdrop scrim.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  clientCreateKey,
  clientCreateWebhook,
  clientDeleteWebhook,
  clientListDeliveries,
  clientRetryDelivery,
  clientRevokeKey,
  clientTestWebhook,
  clientUpdateWebhook,
} from '@/lib/api/public-api-client';
import { cn } from '@/lib/utils';
import {
  type ApiKeyDto,
  type ApiScope,
  type CreateApiKeyResult,
  type CreateWebhookEndpointResult,
  type PublicApiWebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookEventType,
  apiScopeValues,
  webhookEventTypeValues,
} from '@ustowdispatch/shared';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { type FormEvent, type JSX, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initialKeys: ApiKeyDto[];
  initialWebhooks: WebhookEndpointDto[];
}

export function ApiSettingsClient({ initialKeys, initialWebhooks }: Props): JSX.Element {
  const [keys, setKeys] = useState<ApiKeyDto[]>(initialKeys);
  const [webhooks, setWebhooks] = useState<WebhookEndpointDto[]>(initialWebhooks);
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpointDto | null>(null);

  return (
    <div className="space-y-10">
      <KeysSection
        keys={keys}
        onCreate={() => setCreateKeyOpen(true)}
        onRevoked={(k) => setKeys((prev) => prev.map((x) => (x.id === k.id ? k : x)))}
      />

      <WebhooksSection
        webhooks={webhooks}
        onCreate={() => setCreateWebhookOpen(true)}
        onUpdated={(w) => setWebhooks((prev) => prev.map((x) => (x.id === w.id ? w : x)))}
        onDeleted={(id) => setWebhooks((prev) => prev.filter((x) => x.id !== id))}
        onViewDeliveries={setDeliveriesFor}
      />

      {createKeyOpen ? (
        <CreateKeyModal
          onClose={() => setCreateKeyOpen(false)}
          onCreated={(k) => setKeys((prev) => [k, ...prev])}
        />
      ) : null}

      {createWebhookOpen ? (
        <CreateWebhookModal
          onClose={() => setCreateWebhookOpen(false)}
          onCreated={(w) => setWebhooks((prev) => [w, ...prev])}
        />
      ) : null}

      {deliveriesFor ? (
        <DeliveriesModal endpoint={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      ) : null}
    </div>
  );
}

// ======================================================================
// API keys
// ======================================================================

function KeysSection({
  keys,
  onCreate,
  onRevoked,
}: {
  keys: ApiKeyDto[];
  onCreate: () => void;
  onRevoked: (k: ApiKeyDto) => void;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary-on-dark">
          <KeyRound className="h-5 w-5 text-brand-primary" /> API keys
        </h2>
        <Button type="button" onClick={onCreate}>
          Create key
        </Button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th>Scopes</Th>
              <Th>Last used</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {keys.map((k) => (
              <KeyRow key={k.id} apiKey={k} onRevoked={onRevoked} />
            ))}
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-text-secondary-on-dark">
                  No API keys yet. Create one to start using the public REST API.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeyRow({
  apiKey,
  onRevoked,
}: {
  apiKey: ApiKeyDto;
  onRevoked: (k: ApiKeyDto) => void;
}): JSX.Element {
  const [revoking, setRevoking] = useState(false);
  const revoked = apiKey.revokedAt !== null;
  const expired = apiKey.expiresAt !== null && new Date(apiKey.expiresAt).getTime() <= Date.now();

  async function revoke(): Promise<void> {
    if (!window.confirm(`Revoke "${apiKey.name}"? Any integration using it will stop working.`)) {
      return;
    }
    setRevoking(true);
    try {
      const updated = await clientRevokeKey(apiKey.id);
      onRevoked(updated);
      toast.success(`"${apiKey.name}" revoked.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <tr className="hover:bg-bg-surface-elevated/30">
      <td className="px-4 py-3 align-middle font-medium text-text-primary-on-dark">
        {apiKey.name}
      </td>
      <td className="px-4 py-3 align-middle">
        <code className="font-mono text-xs text-text-secondary-on-dark">
          tc_live_{apiKey.prefix}…
        </code>
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-wrap gap-1">
          {apiKey.scopes.map((s) => (
            <ScopeChip key={s} scope={s} />
          ))}
        </div>
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : 'Never'}
      </td>
      <td className="px-4 py-3 align-middle">
        {revoked ? (
          <StatusPill tone="danger">Revoked</StatusPill>
        ) : expired ? (
          <StatusPill tone="warning">Expired</StatusPill>
        ) : (
          <StatusPill tone="success">Active</StatusPill>
        )}
      </td>
      <td className="px-4 py-3 align-middle text-right">
        {revoked ? (
          <span className="text-xs text-text-secondary-on-dark">—</span>
        ) : (
          <button
            type="button"
            onClick={revoke}
            disabled={revoking}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-semibold text-danger transition-colors hover:border-danger/60 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            {revoking ? 'Revoking…' : 'Revoke'}
          </button>
        )}
      </td>
    </tr>
  );
}

function CreateKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (k: ApiKeyDto) => void;
}): JSX.Element {
  const dialogRef = useDialog();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set(['jobs:read']));
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateApiKeyResult | null>(null);

  function toggleScope(scope: ApiScope): void {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    if (scopes.size === 0) {
      setErrorMessage('Select at least one scope.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await clientCreateKey({
        name: name.trim(),
        scopes: Array.from(scopes),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      setCreated(result);
      onCreated(result.apiKey);
      toast.success(`Key "${result.apiKey.name}" created.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      dialogRef={dialogRef}
      titleId="create-key-title"
      title={created ? 'Save your API key' : 'Create API key'}
      onClose={onClose}
    >
      {created ? (
        <SecretReveal
          label="API key"
          secret={created.plaintextKey}
          note="This is the only time the full key is shown. Store it somewhere safe — you can’t retrieve it later."
          onDone={onClose}
        />
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              placeholder="e.g. Zapier integration"
            />
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-text-primary-on-dark">Scopes</legend>
            <div className="grid grid-cols-2 gap-2">
              {apiScopeValues.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-primary"
                    checked={scopes.has(s)}
                    onChange={() => toggleScope(s)}
                  />
                  <code className="font-mono text-xs">{s}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="key-expiry">Expires (optional)</Label>
            <Input
              id="key-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
          <ModalActions onCancel={onClose} submitting={submitting} submitLabel="Create key" />
        </form>
      )}
    </Modal>
  );
}

// ======================================================================
// Webhooks
// ======================================================================

function WebhooksSection({
  webhooks,
  onCreate,
  onUpdated,
  onDeleted,
  onViewDeliveries,
}: {
  webhooks: WebhookEndpointDto[];
  onCreate: () => void;
  onUpdated: (w: WebhookEndpointDto) => void;
  onDeleted: (id: string) => void;
  onViewDeliveries: (w: WebhookEndpointDto) => void;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary-on-dark">
          <Webhook className="h-5 w-5 text-brand-primary" /> Webhook endpoints
        </h2>
        <Button type="button" onClick={onCreate}>
          Add endpoint
        </Button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-divider">
        <table className="w-full divide-y divide-divider text-sm">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <Th>URL</Th>
              <Th>Events</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {webhooks.map((w) => (
              <WebhookRow
                key={w.id}
                webhook={w}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
                onViewDeliveries={() => onViewDeliveries(w)}
              />
            ))}
            {webhooks.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-text-secondary-on-dark">
                  No webhook endpoints yet. Add one to receive event deliveries.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WebhookRow({
  webhook,
  onUpdated,
  onDeleted,
  onViewDeliveries,
}: {
  webhook: WebhookEndpointDto;
  onUpdated: (w: WebhookEndpointDto) => void;
  onDeleted: (id: string) => void;
  onViewDeliveries: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function toggleActive(): Promise<void> {
    setBusy(true);
    try {
      const updated = await clientUpdateWebhook(webhook.id, { active: !webhook.active });
      onUpdated(updated);
      toast.success(updated.active ? 'Endpoint enabled.' : 'Endpoint paused.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    setBusy(true);
    try {
      const delivery = await clientTestWebhook(webhook.id);
      if (delivery.status === 'delivered')
        toast.success(`Test delivered (HTTP ${delivery.responseCode}).`);
      else
        toast.error(`Test failed: ${delivery.lastError ?? `HTTP ${delivery.responseCode ?? '—'}`}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete this webhook endpoint?\n${webhook.url}`)) return;
    setBusy(true);
    try {
      await clientDeleteWebhook(webhook.id);
      onDeleted(webhook.id);
      toast.success('Endpoint deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-bg-surface-elevated/30">
      <td className="px-4 py-3 align-middle">
        <div
          className="max-w-xs truncate font-mono text-xs text-text-primary-on-dark"
          title={webhook.url}
        >
          {webhook.url}
        </div>
        {webhook.description ? (
          <div className="text-xs text-text-secondary-on-dark">{webhook.description}</div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-wrap gap-1">
          {webhook.events.map((e) => (
            <code
              key={e}
              className="rounded bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary-on-dark"
            >
              {e}
            </code>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        {webhook.active ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : (
          <StatusPill tone="warning">Paused</StatusPill>
        )}
      </td>
      <td className="px-4 py-3 align-middle text-right">
        <div className="inline-flex items-center gap-1">
          <IconBtn title="Send test event" onClick={test} disabled={busy}>
            <Send className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="View deliveries" onClick={onViewDeliveries} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconBtn>
          <button
            type="button"
            onClick={toggleActive}
            disabled={busy}
            className="rounded-md border border-divider px-2 py-1 text-xs font-semibold text-text-secondary-on-dark hover:border-divider-strong disabled:opacity-40"
          >
            {webhook.active ? 'Pause' : 'Enable'}
          </button>
          <IconBtn title="Delete" onClick={remove} disabled={busy} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </td>
    </tr>
  );
}

function CreateWebhookModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (w: WebhookEndpointDto) => void;
}): JSX.Element {
  const dialogRef = useDialog();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<Set<WebhookEventType>>(new Set(webhookEventTypeValues));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateWebhookEndpointResult | null>(null);

  function toggleEvent(evt: WebhookEventType): void {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(evt)) next.delete(evt);
      else next.add(evt);
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    if (events.size === 0) {
      setErrorMessage('Select at least one event.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await clientCreateWebhook({
        url: url.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        events: Array.from(events),
      });
      setCreated(result);
      onCreated(result.endpoint);
      toast.success('Webhook endpoint created.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      dialogRef={dialogRef}
      titleId="create-webhook-title"
      title={created ? 'Save your signing secret' : 'Add webhook endpoint'}
      onClose={onClose}
    >
      {created ? (
        <SecretReveal
          label="Signing secret"
          secret={created.signingSecret}
          note="Use this to verify the X-TowCommand-Signature header on each delivery. This is the only time it’s shown."
          onDone={onClose}
        />
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wh-url">Endpoint URL</Label>
            <Input
              id="wh-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://example.com/webhooks/ustow"
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              Must be https.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-desc">Description (optional)</Label>
            <Input
              id="wh-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-text-primary-on-dark">Events</legend>
            <div className="grid grid-cols-2 gap-2">
              {webhookEventTypeValues.map((evt) => (
                <label key={evt} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-primary"
                    checked={events.has(evt)}
                    onChange={() => toggleEvent(evt)}
                  />
                  <code className="font-mono text-xs">{evt}</code>
                </label>
              ))}
            </div>
          </fieldset>
          {errorMessage ? <ErrorNote>{errorMessage}</ErrorNote> : null}
          <ModalActions onCancel={onClose} submitting={submitting} submitLabel="Add endpoint" />
        </form>
      )}
    </Modal>
  );
}

function DeliveriesModal({
  endpoint,
  onClose,
}: {
  endpoint: WebhookEndpointDto;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useDialog();
  const [deliveries, setDeliveries] = useState<PublicApiWebhookDeliveryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function load(): Promise<void> {
    setError(null);
    try {
      setDeliveries(await clientListDeliveries(endpoint.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deliveries');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry(id: string): Promise<void> {
    setRetryingId(id);
    try {
      const updated = await clientRetryDelivery(id);
      setDeliveries((prev) => (prev ? prev.map((d) => (d.id === id ? updated : d)) : prev));
      toast.success(
        updated.status === 'delivered'
          ? `Delivered (HTTP ${updated.responseCode}).`
          : 'Retry attempted.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Modal
      dialogRef={dialogRef}
      titleId="deliveries-title"
      title="Recent deliveries"
      onClose={onClose}
      wide
    >
      <p className="mb-3 max-w-prose truncate font-mono text-xs text-text-secondary-on-dark">
        {endpoint.url}
      </p>
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : deliveries === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-text-secondary-on-dark">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : deliveries.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary-on-dark">
          No deliveries yet. Use “Send test” to fire one.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-[10px] border border-divider">
          <table className="w-full divide-y divide-divider text-xs">
            <thead className="sticky top-0 bg-bg-surface text-left">
              <tr>
                <Th>Event</Th>
                <Th>Status</Th>
                <Th>Attempt</Th>
                <Th>Code</Th>
                <Th>When</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 font-mono">{d.eventType}</td>
                  <td className="px-3 py-2">
                    <DeliveryStatusPill status={d.status} />
                  </td>
                  <td className="px-3 py-2 text-text-secondary-on-dark">
                    {d.attempt}/{d.maxAttempts}
                  </td>
                  <td className="px-3 py-2 text-text-secondary-on-dark">{d.responseCode ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary-on-dark">
                    {new Date(d.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => retry(d.id)}
                      disabled={retryingId === d.id || d.status === 'delivered'}
                      className="inline-flex items-center gap-1 rounded-md border border-divider px-2 py-1 font-semibold text-text-secondary-on-dark hover:border-divider-strong disabled:opacity-40"
                    >
                      {retryingId === d.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Retry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ======================================================================
// Shared presentational helpers
// ======================================================================

function useDialog(): React.MutableRefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return ref;
}

function Modal({
  dialogRef,
  titleId,
  title,
  onClose,
  children,
  wide,
}: {
  dialogRef: React.MutableRefObject<HTMLDialogElement | null>;
  titleId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        'w-full rounded-[14px] border border-divider bg-bg-surface p-0 text-text-primary-on-dark shadow-xl backdrop:bg-bg-base/60 backdrop:backdrop-blur',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary-on-dark">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

function SecretReveal({
  label,
  secret,
  note,
  onDone,
}: {
  label: string;
  secret: string;
  note: string;
  onDone: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select and copy manually.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-[10px] border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{note}</span>
      </div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all break-all rounded-[10px] border border-divider bg-bg-base px-3 py-2 font-mono text-xs text-text-primary-on-dark">
          {secret}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-divider px-2 py-2 text-xs font-semibold text-text-secondary-on-dark hover:border-divider-strong"
        >
          {copied ? (
            <Check className="h-4 w-4 text-status-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="flex justify-end pt-2">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  submitting,
  submitLabel,
}: {
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
      >
        Cancel
      </button>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p
      role="alert"
      className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {children}
    </p>
  );
}

function ScopeChip({ scope }: { scope: ApiScope }): JSX.Element {
  return (
    <code className="rounded bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary-on-dark">
      {scope}
    </code>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}): JSX.Element {
  const toneClass =
    tone === 'success'
      ? 'bg-status-success/15 text-status-success'
      : tone === 'warning'
        ? 'bg-status-warning/15 text-status-warning'
        : 'bg-danger/15 text-danger';
  return (
    <span
      className={cn(
        'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

function DeliveryStatusPill({
  status,
}: { status: PublicApiWebhookDeliveryDto['status'] }): JSX.Element {
  const tone =
    status === 'delivered' ? 'success' : status === 'failed' ? 'danger' : ('warning' as const);
  return <StatusPill tone={tone as 'success' | 'warning' | 'danger'}>{status}</StatusPill>;
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border px-2 py-1 transition-colors disabled:opacity-40',
        danger
          ? 'border-danger/30 bg-danger/5 text-danger hover:border-danger/60'
          : 'border-divider text-text-secondary-on-dark hover:border-divider-strong',
      )}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
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
