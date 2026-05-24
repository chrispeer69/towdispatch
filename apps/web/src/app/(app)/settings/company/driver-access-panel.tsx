'use client';
/**
 * DriverAccessPanel — surfaces the 6-digit company code on Settings → Company.
 *
 * The dispatcher reads the code (or copies it) and shares it with their
 * drivers via text, email, or printed badge. Drivers enter the code on
 * /driver/login on their phone or tablet — they don't need to know the
 * URL slug. There's also a one-tap vanity link the dispatcher can text:
 * `https://app.towcommand.cloud/driver/d/<code>`.
 *
 * Read-only on the operator side. The code is rotated only via support
 * (we don't expose a rotation control here because rotating it logs out
 * every driver on the tenant — that's a deliberate stop-the-world event).
 */
import { Button } from '@/components/ui/button';
import { Check, Copy, Smartphone } from 'lucide-react';
import { type JSX, useState } from 'react';

interface DriverAccessPanelProps {
  companyCode: string;
}

export function DriverAccessPanel({ companyCode }: DriverAccessPanelProps): JSX.Element {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const vanityLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/driver/d/${companyCode}`
      : `/driver/d/${companyCode}`;

  async function copy(text: string, kind: 'code' | 'link'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // No-op if clipboard isn't available.
    }
  }

  return (
    <section className="rounded-[14px] border border-divider bg-bg-surface-elevated/40 p-5">
      <header className="mb-3 flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-text-secondary-on-dark" />
        <h2 className="font-condensed text-xs font-extrabold uppercase tracking-wider text-text-secondary-on-dark">
          Driver Access
        </h2>
      </header>

      <p className="mb-4 max-w-prose text-sm text-text-secondary-on-dark">
        Drivers sign into the in-truck app at <span className="font-mono">/driver/login</span> using
        your 6-digit company code. They only need to enter it once on each device — their phone or
        tablet remembers it on subsequent sign-ins.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[12px] border border-divider px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Company Code
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="font-mono text-2xl font-bold tracking-[0.25em]">{companyCode}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copy(companyCode, 'code')}
              type="button"
              aria-label="Copy company code"
            >
              {copied === 'code' ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="rounded-[12px] border border-divider px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
            One-Tap Driver Link
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="break-all font-mono text-xs">{vanityLink}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copy(vanityLink, 'link')}
              type="button"
              aria-label="Copy one-tap link"
            >
              {copied === 'link' ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-text-secondary-on-dark">
            Text or email this link to a driver. Tapping it on their phone binds the device to your
            workshop automatically.
          </p>
        </div>
      </div>
    </section>
  );
}
