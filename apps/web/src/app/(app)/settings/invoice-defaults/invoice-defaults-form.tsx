'use client';

/**
 * /settings/invoice-defaults — preferences capture under
 * tenants.settings.invoiceDefaults (jsonb). Same pattern as
 * /settings/tax-fees: persists, but the invoicing pipeline doesn't
 * read these yet — invoice generation still uses column defaults
 * (terms = 'net_30') and hard-coded strings.
 *
 * When the billing service is updated to consult tenant settings,
 * these values start applying to new invoices automatically.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type InvoiceTerms, type TenantDto, invoiceTermsValues } from '@towdispatch/shared';
import { Lock } from 'lucide-react';
import { type FormEvent, type JSX, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initial: TenantDto;
}

interface InvoiceDefaults {
  terms?: InvoiceTerms;
  numberPrefix?: string;
  footerText?: string;
  paymentInstructions?: string;
  emailSubjectTemplate?: string;
}

const TERMS_LABEL: Record<InvoiceTerms, string> = {
  due_on_receipt: 'Due on receipt',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  net_60: 'Net 60',
  cod: 'COD (cash on delivery)',
  prepay: 'Prepay',
};

function readInvoiceDefaults(tenant: TenantDto): InvoiceDefaults {
  return (
    (tenant.settings as { invoiceDefaults?: InvoiceDefaults } | undefined)?.invoiceDefaults ?? {}
  );
}

export function InvoiceDefaultsForm({ initial }: Props): JSX.Element {
  const [tenant, setTenant] = useState<TenantDto>(initial);
  const current = readInvoiceDefaults(tenant);

  const [terms, setTerms] = useState<InvoiceTerms>(current.terms ?? 'net_30');
  const [numberPrefix, setNumberPrefix] = useState(current.numberPrefix ?? '');
  const [footerText, setFooterText] = useState(current.footerText ?? '');
  const [paymentInstructions, setPaymentInstructions] = useState(current.paymentInstructions ?? '');
  const [emailSubjectTemplate, setEmailSubjectTemplate] = useState(
    current.emailSubjectTemplate ?? '',
  );

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionLocked, setPermissionLocked] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);

    const next: InvoiceDefaults = { terms };
    if (numberPrefix.trim()) next.numberPrefix = numberPrefix.trim();
    if (footerText.trim()) next.footerText = footerText.trim();
    if (paymentInstructions.trim()) next.paymentInstructions = paymentInstructions.trim();
    if (emailSubjectTemplate.trim()) next.emailSubjectTemplate = emailSubjectTemplate.trim();

    const existingSettings = (tenant.settings ?? {}) as Record<string, unknown>;
    const nextSettings = { ...existingSettings, invoiceDefaults: next };

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
      toast.success('Invoice defaults saved.');
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
            You don&rsquo;t have permission to edit invoice defaults
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
          These values save to <code className="font-mono">tenants.settings.invoiceDefaults</code>{' '}
          and persist across sessions. The invoicing pipeline doesn&rsquo;t read them yet — invoice
          generation still uses column defaults (
          <code className="font-mono">terms = &lsquo;net_30&rsquo;</code>) and hard-coded PDF
          strings. The values you save here become live when the billing service is updated to
          consult tenant settings.
        </p>
      </section>

      <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
        <header>
          <h2 className="font-semibold text-text-primary-on-dark">Defaults</h2>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="default-terms">Default payment terms</Label>
            <select
              id="default-terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value as InvoiceTerms)}
              className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
            >
              {invoiceTermsValues.map((t) => (
                <option key={t} value={t}>
                  {TERMS_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="number-prefix">Invoice number prefix</Label>
            <Input
              id="number-prefix"
              type="text"
              value={numberPrefix}
              onChange={(e) => setNumberPrefix(e.target.value.toUpperCase())}
              placeholder="ROAD, ACME, etc."
              maxLength={8}
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              Up to 8 chars. Will be uppercased and stamped before the sequence number.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="footer-text">PDF footer text</Label>
          <textarea
            id="footer-text"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Thank you for your business."
            rows={2}
            maxLength={500}
            className="w-full resize-y rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark focus:outline-none focus:ring-1 focus:ring-brand-primary/40 focus:border-brand-primary/60"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="payment-instructions">Payment instructions</Label>
          <textarea
            id="payment-instructions"
            value={paymentInstructions}
            onChange={(e) => setPaymentInstructions(e.target.value)}
            placeholder="Mail checks to … or pay online at …"
            rows={3}
            maxLength={1000}
            className="w-full resize-y rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark focus:outline-none focus:ring-1 focus:ring-brand-primary/40 focus:border-brand-primary/60"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-subject">Invoice email subject template</Label>
          <Input
            id="email-subject"
            type="text"
            value={emailSubjectTemplate}
            onChange={(e) => setEmailSubjectTemplate(e.target.value)}
            placeholder="Invoice {invoiceNumber} from {tenantName}"
            maxLength={200}
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
            Tokens: {'{invoiceNumber}'}, {'{tenantName}'}, {'{customerName}'}
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
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save invoice defaults'}
          </Button>
        </div>
      </section>
    </form>
  );
}
