'use client';

/**
 * /settings/company — live editor for the tenant's Company Profile.
 *
 * Editable today (against the backend's PATCH /tenants/current):
 *   - name   (display name shown on invoices, PDFs, the sidebar)
 *
 * NOT editable today because the `tenants` table doesn't model them
 * yet (would need a schema migration before the form can save):
 *   - slug (immutable by design — it's part of URLs and the API key)
 *   - billing address, phone, contact email
 *   - logo / brand color
 *   - default currency, default timezone
 *
 * The non-editable fields are displayed as informational rows below
 * the form so the operator sees what's locked vs editable, and so the
 * "what's missing" gap is honest. When the schema lands, each row
 * gains an editor and a save handler.
 *
 * Role gate: PATCH /tenants/current requires OWNER or ADMIN. Lesser
 * roles hit 403 — surfaced as a permission banner so dispatchers /
 * drivers understand why the form is read-only for them.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TenantDto } from '@ustowdispatch/shared';
import { Lock } from 'lucide-react';
import { type FormEvent, type JSX, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initial: TenantDto;
}

export function CompanyProfileForm({ initial }: Props): JSX.Element {
  const [name, setName] = useState(initial.name);
  const [tenant, setTenant] = useState<TenantDto>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionLocked, setPermissionLocked] = useState(false);

  const dirty = name.trim() !== tenant.name.trim();

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!dirty || submitting) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setErrorMessage('Company name cannot be empty.');
      return;
    }
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/tenants/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          code?: string;
          message?: string;
        } | null;
        if (res.status === 401 || res.status === 403) {
          setPermissionLocked(true);
          setErrorMessage(null);
          return;
        }
        setErrorMessage(body?.message ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      const updated = (await res.json()) as TenantDto;
      setTenant(updated);
      setName(updated.name);
      toast.success('Company profile saved.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (permissionLocked) {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-[14px] border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
      >
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
        <div>
          <p className="font-semibold text-text-primary-on-dark">
            You don&rsquo;t have permission to edit Company Profile
          </p>
          <p className="mt-1 text-text-secondary-on-dark">
            Editing the company profile is gated to Owner and Admin roles. Ask an admin to switch
            your role or save the change on your behalf.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <header>
          <h2 className="font-semibold text-text-primary-on-dark">Editable</h2>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Saved against <code className="font-mono">PATCH /tenants/current</code> — the updated
            value appears on invoice PDFs and in the sidebar within seconds of saving.
          </p>
        </header>

        <div className="space-y-1.5">
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            type="text"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Roadside Towing and Recovery, Inc."
            autoComplete="organization"
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark/60">
            Max 120 characters
          </p>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!dirty || submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
          {dirty ? (
            <button
              type="button"
              onClick={() => {
                setName(tenant.name);
                setErrorMessage(null);
              }}
              disabled={submitting}
              className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
            >
              Revert
            </button>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
        <header>
          <h2 className="font-semibold text-text-primary-on-dark">Identity (read-only)</h2>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Locked because they affect URLs, API keys, or stable references and changing them would
            invalidate existing data.
          </p>
        </header>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <ReadOnlyField label="Slug" value={tenant.slug} mono />
          <ReadOnlyField label="Status" value={tenant.status} mono />
          <ReadOnlyField label="Created" value={new Date(tenant.createdAt).toLocaleString()} />
          <ReadOnlyField label="Last updated" value={new Date(tenant.updatedAt).toLocaleString()} />
        </dl>
      </section>

      <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
        <header>
          <h2 className="font-semibold text-text-primary-on-dark">Not modelled yet</h2>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            These fields aren&rsquo;t on the <code className="font-mono">tenants</code> table yet.
            Each needs a small schema migration + a column added to the PATCH endpoint before it
            becomes editable here. Logged as a follow-up.
          </p>
        </header>
        <ul className="space-y-1.5 text-sm text-text-secondary-on-dark">
          <li>
            <span className="font-medium text-text-primary-on-dark">Billing address</span> — street,
            city, state, ZIP. Appears on invoice PDFs as the &ldquo;from&rdquo; address.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">Primary phone</span> —
            customer-facing dispatch number, also used on invoice PDFs.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">Contact email</span> — reply-to
            address for outbound transactional emails.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">Logo + brand colour</span> —
            used on the customer-facing tracking page and invoice PDFs.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">
              Default timezone + currency
            </span>{' '}
            — currently hard-coded to UTC + USD across the app.
          </li>
        </ul>
      </section>
    </form>
  );
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/40 p-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
        {label}
      </dt>
      <dd className={`mt-1 text-text-primary-on-dark ${mono ? 'font-mono text-sm' : 'text-sm'}`}>
        {value}
      </dd>
    </div>
  );
}
