'use client';

/**
 * /settings/tax-fees — live preferences capture.
 *
 * No dedicated `tenant_tax_settings` table exists yet. As a stop-gap,
 * this form reads + writes a sub-object inside `tenants.settings`
 * (jsonb), which is already plumbed through PATCH /tenants/current.
 * The shape is documented inline below so the eventual schema
 * migration can hydrate the existing values straight out of the
 * jsonb blob.
 *
 * Important caveat displayed in the UI: saving here captures the
 * tenant's intent, but the invoicing pipeline does not yet read
 * these values. Invoice generation still uses the per-line
 * `taxable` / `taxRatePct` columns with a hard-coded '0' default.
 * When invoice generation is updated to consult tenants.settings.tax,
 * these values will start affecting new invoices automatically.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TenantDto } from '@towdispatch/shared';
import { Lock } from 'lucide-react';
import { type FormEvent, type JSX, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initial: TenantDto;
}

/**
 * Shape stored in tenants.settings.tax. Everything optional so the
 * absence of a key === "use the legacy hard-coded default".
 */
interface TaxSettings {
  defaultRatePct?: number;
  jurisdiction?: string;
  taxName?: string;
  applyByDefault?: boolean;
  exemptServiceCodes?: string[];
}

function readTaxSettings(tenant: TenantDto): TaxSettings {
  const raw = (tenant.settings as { tax?: TaxSettings } | undefined)?.tax;
  return raw ?? {};
}

export function TaxFeesForm({ initial }: Props): JSX.Element {
  const [tenant, setTenant] = useState<TenantDto>(initial);
  const current = readTaxSettings(tenant);

  const [defaultRatePct, setDefaultRatePct] = useState(
    current.defaultRatePct != null ? String(current.defaultRatePct) : '',
  );
  const [jurisdiction, setJurisdiction] = useState(current.jurisdiction ?? '');
  const [taxName, setTaxName] = useState(current.taxName ?? '');
  const [applyByDefault, setApplyByDefault] = useState(current.applyByDefault ?? false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionLocked, setPermissionLocked] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);

    const parsedRate = defaultRatePct.trim() === '' ? undefined : Number(defaultRatePct);
    if (
      parsedRate !== undefined &&
      (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100)
    ) {
      setErrorMessage('Default tax rate must be a number between 0 and 100.');
      return;
    }

    const nextTax: TaxSettings = {};
    if (parsedRate !== undefined) nextTax.defaultRatePct = parsedRate;
    if (jurisdiction.trim()) nextTax.jurisdiction = jurisdiction.trim();
    if (taxName.trim()) nextTax.taxName = taxName.trim();
    nextTax.applyByDefault = applyByDefault;

    const existingSettings = (tenant.settings ?? {}) as Record<string, unknown>;
    const nextSettings = { ...existingSettings, tax: nextTax };

    setSubmitting(true);
    try {
      const res = await fetch('/api/tenants/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: nextSettings }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setPermissionLocked(true);
          return;
        }
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setErrorMessage(body?.message ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      const updated = (await res.json()) as TenantDto;
      setTenant(updated);
      toast.success('Tax & fee preferences saved.');
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
            You don&rsquo;t have permission to edit tax settings
          </p>
          <p className="mt-1 text-text-secondary-on-dark">
            Editing tenant-level settings is gated to Owner and Admin roles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="rounded-[14px] border border-status-warning/30 bg-status-warning/5 p-4 text-sm">
        <p className="font-semibold text-text-primary-on-dark">
          Preferences capture, not enforcement
        </p>
        <p className="mt-1 text-text-secondary-on-dark">
          These values save to <code className="font-mono">tenants.settings.tax</code> and persist
          across sessions, but the invoicing pipeline does not yet read them — invoice generation
          still uses the per-line <code className="font-mono">taxable</code> /{' '}
          <code className="font-mono">taxRatePct</code> columns with a hard-coded
          <code className="font-mono"> 0</code> default. When the billing service is updated to
          consult tenant tax settings, the values you save here start applying to new invoices
          automatically.
        </p>
      </section>

      <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <header>
          <h2 className="font-semibold text-text-primary-on-dark">Default tax</h2>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Applied to taxable invoice line items when no per-account override is set.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tax-rate">Default rate (%)</Label>
            <Input
              id="tax-rate"
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              max="100"
              value={defaultRatePct}
              onChange={(e) => setDefaultRatePct(e.target.value)}
              placeholder="7.25"
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              0–100. Leave blank for &ldquo;no default tax&rdquo;.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-name">Tax name (on invoice)</Label>
            <Input
              id="tax-name"
              type="text"
              value={taxName}
              onChange={(e) => setTaxName(e.target.value)}
              placeholder="State sales tax"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="tax-jurisdiction">Tax jurisdiction</Label>
            <Input
              id="tax-jurisdiction"
              type="text"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="e.g. Ohio, Franklin County"
              maxLength={120}
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              Free-text label for the invoice and the audit log.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 md:col-span-2">
            <input
              type="checkbox"
              checked={applyByDefault}
              onChange={(e) => setApplyByDefault(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-divider bg-bg-surface accent-brand-primary"
            />
            <span className="text-sm text-text-primary-on-dark">
              Apply this tax to new invoice line items by default
              <span className="mt-0.5 block font-normal text-text-secondary-on-dark">
                Dispatchers can still uncheck taxability per line at invoice time.
              </span>
            </span>
          </label>
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
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save tax settings'}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
        <header>
          <h2 className="font-semibold text-text-primary-on-dark">Recurring fees</h2>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Per-call admin fees, fuel surcharges, environmental fees, etc.
          </p>
        </header>
        <p className="text-sm text-text-secondary-on-dark">
          Recurring fee management ships with the Master Rate Sheet (see{' '}
          <a href="/settings/services" className="text-brand-primary hover:underline">
            Services &amp; Pricing
          </a>
          ). Fixed line items defined there are appended to every quote that uses the rate sheet.
        </p>
      </section>
    </form>
  );
}
