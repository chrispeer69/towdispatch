'use client';

/**
 * /settings/branding editor (Session 32).
 *
 * Controlled state (not react-hook-form): the update schema is strict +
 * all-nullable, so empty-string-to-null coercion is cleaner managed by hand
 * than fought through a resolver. On save we send all editable keys with
 * trimmed || null; the API validates and returns structured errors.
 *
 * Logo upload reads the file as base64 (logos are small) and POSTs JSON to
 * the BFF — no multipart. The right-hand preview card applies the live
 * colors + logo + support contact exactly as the customer portal will.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BrandingDomainStatus, TenantBrandingDto } from '@ustowdispatch/shared';
import { CheckCircle2, Clock, Upload } from 'lucide-react';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

const DEFAULT_PRIMARY = '#144399';
const DEFAULT_ACCENT = '#0EA5E9';
const MAX_LOGO_BYTES = 2_000_000;

interface Props {
  initial: TenantBrandingDto;
  canEdit: boolean;
}

export function BrandingForm({ initial, canEdit }: Props): JSX.Element {
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor ?? DEFAULT_PRIMARY);
  const [accentColor, setAccentColor] = useState(initial.accentColor ?? DEFAULT_ACCENT);
  const [supportEmail, setSupportEmail] = useState(initial.supportEmail ?? '');
  const [supportPhone, setSupportPhone] = useState(initial.supportPhone ?? '');
  const [termsUrl, setTermsUrl] = useState(initial.termsUrl ?? '');
  const [privacyUrl, setPrivacyUrl] = useState(initial.privacyUrl ?? '');
  const [customDomain, setCustomDomain] = useState(initial.customDomain ?? '');
  const [domainStatus, setDomainStatus] = useState<BrandingDomainStatus>(
    initial.customDomainStatus,
  );
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch('/api/tenant-branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryColor,
          accentColor,
          supportEmail: nullable(supportEmail),
          supportPhone: nullable(supportPhone),
          termsUrl: nullable(termsUrl),
          privacyUrl: nullable(privacyUrl),
          customDomain: nullable(customDomain.toLowerCase()),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | (TenantBrandingDto & { message?: string })
        | null;
      if (!res.ok) {
        toast.error(body?.message ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      if (body) setDomainStatus(body.customDomainStatus);
      toast.success('Branding saved.');
    } finally {
      setSaving(false);
    }
  }

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Logo must be under 2 MB.');
      return;
    }
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch('/api/tenant-branding/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64 }),
      });
      const body = (await res.json().catch(() => null)) as
        | (TenantBrandingDto & { message?: string })
        | null;
      if (!res.ok) {
        toast.error(body?.message ?? `Logo upload failed (HTTP ${res.status}).`);
        return;
      }
      if (body) setLogoUrl(body.logoUrl);
      toast.success('Logo uploaded.');
    } finally {
      setUploading(false);
    }
  }

  const disabled = !canEdit || saving;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Logo */}
        <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
          <h2 className="text-sm font-semibold text-text-primary-on-dark">Logo</h2>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[10px] border border-divider bg-bg-surface-elevated">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={absoluteUrl(logoUrl)}
                  alt="Logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-text-secondary-on-dark">None</span>
              )}
            </div>
            <label className="cursor-pointer">
              <span className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-divider px-4 text-sm font-semibold text-text-primary-on-dark hover:bg-bg-surface-elevated">
                <Upload className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload logo'}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                disabled={!canEdit || uploading}
                onChange={onLogoChange}
              />
            </label>
          </div>
          <p className="text-xs text-text-secondary-on-dark">PNG, JPG, WebP, or SVG, up to 2 MB.</p>
        </section>

        {/* Colors */}
        <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
          <h2 className="text-sm font-semibold text-text-primary-on-dark">Colors</h2>
          <div className="grid grid-cols-2 gap-4">
            <ColorField
              label="Primary"
              value={primaryColor}
              onChange={setPrimaryColor}
              disabled={disabled}
            />
            <ColorField
              label="Accent"
              value={accentColor}
              onChange={setAccentColor}
              disabled={disabled}
            />
          </div>
        </section>

        {/* Support contact */}
        <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
          <h2 className="text-sm font-semibold text-text-primary-on-dark">Support contact</h2>
          <Field label="Support email">
            <Input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@acme-towing.com"
              disabled={disabled}
            />
          </Field>
          <Field label="Support phone">
            <Input
              type="tel"
              value={supportPhone}
              onChange={(e) => setSupportPhone(e.target.value)}
              placeholder="(555) 010-1234"
              disabled={disabled}
            />
          </Field>
        </section>

        {/* Legal */}
        <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
          <h2 className="text-sm font-semibold text-text-primary-on-dark">Legal footer</h2>
          <Field label="Terms of Service URL">
            <Input
              type="url"
              value={termsUrl}
              onChange={(e) => setTermsUrl(e.target.value)}
              placeholder="https://acme-towing.com/terms"
              disabled={disabled}
            />
          </Field>
          <Field label="Privacy Policy URL">
            <Input
              type="url"
              value={privacyUrl}
              onChange={(e) => setPrivacyUrl(e.target.value)}
              placeholder="https://acme-towing.com/privacy"
              disabled={disabled}
            />
          </Field>
        </section>

        {/* Custom domain */}
        <section className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary-on-dark">Custom domain</h2>
            <DomainStatusPill status={domainStatus} />
          </div>
          <Field label="Vanity domain">
            <Input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="portal.acme-towing.com"
              disabled={disabled}
            />
          </Field>
          <p className="text-xs text-text-secondary-on-dark">
            Always available:{' '}
            <span className="font-mono text-text-primary-on-dark">{initial.fallbackDomain}</span>. A
            custom domain must be pointed at us and verified before it goes live — see the
            custom-domain runbook.
          </p>
        </section>

        {canEdit ? (
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save branding'}
          </Button>
        ) : (
          <p className="text-sm text-text-secondary-on-dark">
            You have read-only access to branding.
          </p>
        )}
      </div>

      {/* Live preview */}
      <BrandingPreview
        logoUrl={logoUrl}
        primaryColor={primaryColor}
        accentColor={accentColor}
        supportEmail={supportEmail}
        supportPhone={supportPhone}
      />
    </div>
  );
}

function ColorField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          className="h-10 w-12 cursor-pointer rounded-[8px] border border-divider bg-bg-surface disabled:cursor-not-allowed"
          aria-label={`${props.label} color`}
        />
        <Input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          className="font-mono"
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DomainStatusPill({ status }: { status: BrandingDomainStatus }): JSX.Element {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-success/15 px-2.5 py-1 text-xs font-semibold text-status-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2.5 py-1 text-xs font-semibold text-status-warning">
        <Clock className="h-3.5 w-3.5" /> Pending verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-bg-surface-elevated px-2.5 py-1 text-xs font-semibold text-text-secondary-on-dark">
      Not set
    </span>
  );
}

function BrandingPreview(props: {
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  supportPhone: string;
}): JSX.Element {
  return (
    <aside className="space-y-3">
      <h2 className="text-sm font-semibold text-text-primary-on-dark">Preview</h2>
      <div className="overflow-hidden rounded-[14px] border border-divider">
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ backgroundColor: props.primaryColor }}
        >
          {props.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={absoluteUrl(props.logoUrl)}
              alt=""
              className="h-8 w-8 rounded object-contain"
            />
          ) : (
            <div className="h-8 w-8 rounded bg-white/30" />
          )}
          <span className="text-sm font-bold text-white">Customer Portal</span>
        </div>
        <div className="space-y-3 bg-bg-surface p-4">
          <div className="space-y-1">
            <div className="h-2 w-2/3 rounded bg-divider" />
            <div className="h-2 w-1/2 rounded bg-divider" />
          </div>
          <button
            type="button"
            className="rounded-[8px] px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: props.accentColor }}
          >
            Pay invoice
          </button>
          <p className="text-[11px] text-text-secondary-on-dark">
            Need help? {props.supportEmail || 'support@example.com'}
            {props.supportPhone ? ` · ${props.supportPhone}` : ''}
          </p>
        </div>
      </div>
    </aside>
  );
}

function nullable(v: string): string | null {
  const t = v.trim();
  return t.length ? t : null;
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  return `${base}${url}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('read failed'));
        return;
      }
      // Strip the "data:<mime>;base64," prefix — the API expects raw base64.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
