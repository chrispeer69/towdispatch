'use client';

/**
 * /settings/sso — Enterprise SSO admin client (Session 38).
 *
 * Talks to the BFF proxy at /api/sso/* (→ /admin/sso/*, OWNER/ADMIN gated).
 *   - Connections: list, add (SAML or OIDC), enable/disable, delete,
 *     test-login (opens the SP-initiated /sso/:slug/{provider}/login).
 *   - SCIM tokens: list, mint (plaintext shown ONCE), revoke.
 *   - Login audit: recent attempts (outcome / provider / subject / ip / time).
 *
 * Modals use the native <dialog> element (browser focus-trap + Escape).
 * 401/403 surface as toasts so an unprivileged user gets a clear message.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  type CreateSsoConnectionPayload,
  type ScimTokenDto,
  type SsoConnectionDto,
  type SsoLoginAuditDto,
  ssoDefaultRoleValues,
} from '@ustowdispatch/shared';
import { ExternalLink, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, type JSX, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initialConnections: SsoConnectionDto[];
  initialTokens: ScimTokenDto[];
  initialAudit: SsoLoginAuditDto[];
}

export function SsoClient({ initialConnections, initialTokens, initialAudit }: Props): JSX.Element {
  const [connections, setConnections] = useState<SsoConnectionDto[]>(initialConnections);
  const [tokens, setTokens] = useState<ScimTokenDto[]>(initialTokens);
  const [audit] = useState<SsoLoginAuditDto[]>(initialAudit);
  const [addOpen, setAddOpen] = useState(false);
  const [mintOpen, setMintOpen] = useState(false);

  return (
    <div className="space-y-10">
      {/* ---------------- Connections ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary-on-dark">Identity providers</h2>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add connection
          </Button>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-divider">
          <table className="w-full divide-y divide-divider text-sm">
            <thead className="bg-bg-surface/60 text-left">
              <tr>
                <Th>Provider</Th>
                <Th>Name</Th>
                <Th>Default role</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {connections.map((c) => (
                <ConnectionRow
                  key={c.id}
                  connection={c}
                  onChange={(u) =>
                    setConnections((prev) => prev.map((x) => (x.id === u.id ? u : x)))
                  }
                  onDelete={(id) => setConnections((prev) => prev.filter((x) => x.id !== id))}
                />
              ))}
              {connections.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm text-text-secondary-on-dark"
                  >
                    No SSO connections yet. Click <strong>Add connection</strong> to wire up SAML or
                    OIDC.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- SCIM tokens ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary-on-dark">
            SCIM provisioning tokens
          </h2>
          <Button type="button" variant="outline" onClick={() => setMintOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Mint token
          </Button>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-divider">
          <table className="w-full divide-y divide-divider text-sm">
            <thead className="bg-bg-surface/60 text-left">
              <tr>
                <Th>Name</Th>
                <Th>Token</Th>
                <Th>Last used</Th>
                <Th>Expires</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {tokens.map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  onRevoke={(id) =>
                    setTokens((prev) =>
                      prev.map((x) =>
                        x.id === id ? { ...x, revokedAt: new Date().toISOString() } : x,
                      ),
                    )
                  }
                />
              ))}
              {tokens.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-text-secondary-on-dark"
                  >
                    No SCIM tokens. Mint one and paste it into your IdP&rsquo;s provisioning config.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-secondary-on-dark">
          SCIM base URL: <code className="font-mono">/scim/v2</code> — present the token as a{' '}
          <code className="font-mono">Bearer</code> credential.
        </p>
      </section>

      {/* ---------------- Login audit ---------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary-on-dark">Recent login activity</h2>
        <div className="overflow-hidden rounded-[14px] border border-divider">
          <table className="w-full divide-y divide-divider text-sm">
            <thead className="bg-bg-surface/60 text-left">
              <tr>
                <Th>When</Th>
                <Th>Provider</Th>
                <Th>Outcome</Th>
                <Th>Subject</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {audit.map((a) => (
                <tr key={a.id} className="hover:bg-bg-surface-elevated/30">
                  <td className="px-4 py-2 text-text-secondary-on-dark">
                    {new Date(a.occurredAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 uppercase">{a.provider ?? '—'}</td>
                  <td className="px-4 py-2">
                    <OutcomeBadge outcome={a.outcome} reason={a.failureReason} />
                  </td>
                  <td className="px-4 py-2 text-text-secondary-on-dark">{a.subject ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-text-secondary-on-dark">
                    {a.ip ?? '—'}
                  </td>
                </tr>
              ))}
              {audit.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-text-secondary-on-dark"
                  >
                    No SSO login attempts recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {addOpen ? (
        <AddConnectionModal
          onClose={() => setAddOpen(false)}
          onCreated={(c) => {
            setConnections((prev) => [...prev, c]);
            setAddOpen(false);
          }}
        />
      ) : null}
      {mintOpen ? (
        <MintTokenModal
          onClose={() => setMintOpen(false)}
          onMinted={(t) => {
            setTokens((prev) => [t, ...prev]);
            setMintOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ConnectionRow({
  connection,
  onChange,
  onDelete,
}: {
  connection: SsoConnectionDto;
  onChange: (c: SsoConnectionDto) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function toggleEnabled(next: boolean): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/sso/connections/${connection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        toast.error(await errText(res, 'Update failed'));
        return;
      }
      onChange((await res.json()) as SsoConnectionDto);
      toast.success(next ? 'Connection enabled.' : 'Connection disabled.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete the ${connection.provider.toUpperCase()} connection?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sso/connections/${connection.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        toast.error(await errText(res, 'Delete failed'));
        return;
      }
      onDelete(connection.id);
      toast.success('Connection deleted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-bg-surface-elevated/30">
      <td className="px-4 py-3 align-middle">
        <span className="rounded bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
          {connection.provider}
        </span>
      </td>
      <td className="px-4 py-3 align-middle font-medium text-text-primary-on-dark">
        {connection.displayName}
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {connection.defaultRole}
      </td>
      <td className="px-4 py-3 align-middle">
        <label className={cn('inline-flex items-center gap-2 text-xs', busy && 'opacity-50')}>
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-brand-primary"
            checked={connection.enabled}
            disabled={busy}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
            {connection.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </td>
      <td className="px-4 py-3 align-middle text-right">
        <div className="inline-flex items-center gap-2">
          <a
            href={connection.loginUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-divider px-2 py-1 text-xs font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
            title="Open the SP-initiated login in a new tab"
          >
            <ExternalLink className="h-3 w-3" />
            Test login
          </a>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-semibold text-danger transition-colors hover:border-danger/60 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function TokenRow({
  token,
  onRevoke,
}: {
  token: ScimTokenDto;
  onRevoke: (id: string) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const revoked = !!token.revokedAt;
  async function revoke(): Promise<void> {
    if (!window.confirm(`Revoke token "${token.name}"? IdPs using it will stop syncing.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sso/tokens/${token.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        toast.error(await errText(res, 'Revoke failed'));
        return;
      }
      onRevoke(token.id);
      toast.success('Token revoked.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <tr className={cn('hover:bg-bg-surface-elevated/30', revoked && 'opacity-50')}>
      <td className="px-4 py-3 align-middle font-medium text-text-primary-on-dark">{token.name}</td>
      <td className="px-4 py-3 align-middle font-mono text-xs text-text-secondary-on-dark">
        {token.tokenPrefix}
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'never'}
      </td>
      <td className="px-4 py-3 align-middle text-text-secondary-on-dark">
        {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'never'}
      </td>
      <td className="px-4 py-3 align-middle text-right">
        {revoked ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
            Revoked
          </span>
        ) : (
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-xs font-semibold text-danger transition-colors hover:border-danger/60 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

function OutcomeBadge({
  outcome,
  reason,
}: {
  outcome: SsoLoginAuditDto['outcome'];
  reason: string | null;
}): JSX.Element {
  const cls =
    outcome === 'success'
      ? 'bg-status-success/15 text-status-success'
      : 'bg-status-warning/15 text-status-warning';
  return (
    <span
      className={cn('rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]', cls)}
      title={reason ?? undefined}
    >
      {outcome}
    </span>
  );
}

function AddConnectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: SsoConnectionDto) => void;
}): JSX.Element {
  const [provider, setProvider] = useState<'saml' | 'oidc'>('saml');
  const [displayName, setDisplayName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [x509Cert, setX509Cert] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');
  const [audience, setAudience] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [defaultRole, setDefaultRole] = useState('dispatcher');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const payload: CreateSsoConnectionPayload = {
        provider,
        displayName: displayName.trim(),
        defaultRole: defaultRole as CreateSsoConnectionPayload['defaultRole'],
        ...(issuer.trim() ? { issuer: issuer.trim() } : {}),
        ...(provider === 'saml'
          ? {
              x509Cert: x509Cert.trim(),
              ssoUrl: ssoUrl.trim(),
              ...(audience.trim() ? { audience: audience.trim() } : {}),
            }
          : {
              oidcClientId: oidcClientId.trim(),
              ...(oidcClientSecret.trim() ? { oidcClientSecret: oidcClientSecret.trim() } : {}),
            }),
      };
      const res = await fetch('/api/sso/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setErrorMessage(await errText(res, 'Create failed'));
        return;
      }
      const created = (await res.json()) as SsoConnectionDto;
      toast.success(`${provider.toUpperCase()} connection created.`);
      onCreated(created);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="add-sso-title"
      onClose={onClose}
      className="w-full max-w-lg rounded-[14px] border border-divider bg-bg-surface p-0 text-text-primary-on-dark shadow-xl backdrop:bg-bg-base/60 backdrop:backdrop-blur"
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <h2 id="add-sso-title" className="text-lg font-semibold">
            Add an SSO connection
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
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sso-provider">Protocol</Label>
            <select
              id="sso-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'saml' | 'oidc')}
              className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm"
            >
              <option value="saml">SAML 2.0</option>
              <option value="oidc">OIDC</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sso-name">Display name</Label>
            <Input
              id="sso-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={160}
              placeholder="Okta — Acme Towing"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sso-issuer">Issuer / Entity ID</Label>
            <Input
              id="sso-issuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder={
                provider === 'oidc' ? 'https://accounts.example.com' : 'https://idp/entity'
              }
            />
          </div>

          {provider === 'saml' ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="sso-url">IdP SSO URL</Label>
                <Input
                  id="sso-url"
                  value={ssoUrl}
                  onChange={(e) => setSsoUrl(e.target.value)}
                  placeholder="https://idp/sso"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sso-cert">IdP X.509 signing certificate (PEM)</Label>
                <textarea
                  id="sso-cert"
                  value={x509Cert}
                  onChange={(e) => setX509Cert(e.target.value)}
                  required
                  rows={4}
                  className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 font-mono text-xs"
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sso-aud">Audience (optional — defaults to SP entity ID)</Label>
                <Input
                  id="sso-aud"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="oidc-client">OIDC client ID</Label>
                <Input
                  id="oidc-client"
                  value={oidcClientId}
                  onChange={(e) => setOidcClientId(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="oidc-secret">OIDC client secret</Label>
                <Input
                  id="oidc-secret"
                  type="password"
                  value={oidcClientSecret}
                  onChange={(e) => setOidcClientSecret(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label htmlFor="sso-role">Default role for new users</Label>
            <select
              id="sso-role"
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value)}
              className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm"
            >
              {ssoDefaultRoleValues.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
            >
              Cancel
            </button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create connection'}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function MintTokenModal({
  onClose,
  onMinted,
}: {
  onClose: () => void;
  onMinted: (t: ScimTokenDto) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [minted, setMinted] = useState<ScimTokenDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const res = await fetch('/api/sso/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(days && Number.isFinite(days) ? { expiresInDays: days } : {}),
        }),
      });
      if (!res.ok) {
        setErrorMessage(await errText(res, 'Mint failed'));
        return;
      }
      const body = (await res.json()) as { token: string; record: ScimTokenDto };
      setPlaintext(body.token);
      setMinted(body.record);
      toast.success('Token minted — copy it now.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="mint-token-title"
      onClose={onClose}
      className="w-full max-w-md rounded-[14px] border border-divider bg-bg-surface p-0 text-text-primary-on-dark shadow-xl backdrop:bg-bg-base/60 backdrop:backdrop-blur"
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <h2 id="mint-token-title" className="text-lg font-semibold">
            Mint a SCIM token
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

        {plaintext ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-text-secondary-on-dark">
              Copy this token now — it is shown <strong>only once</strong>.
            </p>
            <code className="block break-all rounded-[10px] border border-divider bg-bg-base px-3 py-2 font-mono text-xs text-text-primary-on-dark">
              {plaintext}
            </code>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(plaintext);
                  toast.success('Copied to clipboard.');
                }}
              >
                Copy
              </Button>
              <button
                type="button"
                onClick={() => minted && onMinted(minted)}
                className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={160}
                placeholder="Okta provisioning"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="token-exp">Expires in days (optional)</Label>
              <Input
                id="token-exp"
                type="number"
                min={1}
                max={3650}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="never"
              />
            </div>
            {errorMessage ? (
              <p
                role="alert"
                className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              >
                {errorMessage}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
              >
                Cancel
              </button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Minting…' : 'Mint token'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

async function errText(res: Response, fallback: string): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    return 'You don’t have permission to manage SSO (owner / admin only).';
  }
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? `${fallback} (HTTP ${res.status})`;
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
