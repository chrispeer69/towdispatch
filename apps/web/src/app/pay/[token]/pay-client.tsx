'use client';

/**
 * PayClient — renders Stripe Elements against the client_secret returned by
 * the public API. Stripe.js is loaded from js.stripe.com (CDN), NOT bundled,
 * so card data never touches our origin. PCI scope: SAQ A.
 *
 * The client_secret is single-use and tenant-scoped. The connected stripe
 * account id is passed via the `stripeAccount` option to Stripe.js so the
 * payment intent is confirmed on the connected account, not the platform.
 */
import type { PublicPaymentView } from '@ustowdispatch/shared';
import { type JSX, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    // Stripe.js is loaded from CDN; the global has its own complex type, but
    // we narrow to just what we use below.
    Stripe?: (publishableKey: string, options?: { stripeAccount?: string }) => StripeJs;
  }
}

interface StripeJs {
  elements(opts: { clientSecret: string }): StripeElements;
  confirmPayment(opts: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }): Promise<{ error?: { message?: string } }>;
}

interface StripeElements {
  create(type: 'payment'): StripeElement;
  getElement(type: 'payment'): StripeElement | null;
  submit(): Promise<{ error?: { message?: string } }>;
}

interface StripeElement {
  mount(selector: string | HTMLElement): void;
  unmount(): void;
  on(event: string, handler: () => void): void;
}

const STRIPE_JS_SRC = 'https://js.stripe.com/v3/';

interface Props {
  view: PublicPaymentView;
  token: string;
}

export function PayClient({ view, token: _token }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'paid' | 'error'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const publishableKey = view.tenant.publicKey;
  const stripeAccount = view.tenant.stripeAccountId;
  const clientSecret = view.paymentIntent?.clientSecret ?? null;

  useEffect(() => {
    if (!publishableKey || !clientSecret) {
      setStatus('error');
      setErrorMessage(
        publishableKey
          ? 'Payment unavailable — no client secret returned.'
          : 'Stripe is not configured for this operator. Please contact them directly.',
      );
      return;
    }

    let cancelled = false;
    const ensureStripe = async (): Promise<void> => {
      if (window.Stripe) return;
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[src="${STRIPE_JS_SRC}"]`);
        if (existing) {
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => reject(new Error('Failed to load Stripe.js')));
          return;
        }
        const s = document.createElement('script');
        s.src = STRIPE_JS_SRC;
        s.async = true;
        s.onload = (): void => resolve();
        s.onerror = (): void => reject(new Error('Failed to load Stripe.js'));
        document.head.appendChild(s);
      });
    };

    const init = async (): Promise<void> => {
      try {
        await ensureStripe();
        if (cancelled) return;
        const factory = window.Stripe;
        if (!factory) throw new Error('Stripe.js missing');
        const stripe = stripeAccount
          ? factory(publishableKey, { stripeAccount })
          : factory(publishableKey);
        const elements = stripe.elements({ clientSecret });
        const card = elements.create('payment');
        if (mountRef.current) card.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    };
    void init();
    return (): void => {
      cancelled = true;
      const els = elementsRef.current;
      if (els) {
        els.getElement('payment')?.unmount();
      }
    };
  }, [publishableKey, clientSecret, stripeAccount]);

  const submit = async (): Promise<void> => {
    setErrorMessage(null);
    setStatus('submitting');
    try {
      const stripe = stripeRef.current;
      const elements = elementsRef.current;
      if (!stripe || !elements) throw new Error('Stripe not ready');
      const submitRes = await elements.submit();
      if (submitRes.error) throw new Error(submitRes.error.message ?? 'submit failed');
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (result.error) throw new Error(result.error.message ?? 'confirm failed');
      setStatus('paid');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen bg-bg-base text-text-primary-on-dark p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-bg-surface-elevated rounded-lg p-8 space-y-6">
        <header>
          <p className="text-text-secondary-on-dark text-sm">{view.tenant.name}</p>
          <h1 className="text-2xl font-bold">Invoice {view.invoice.invoiceNumber}</h1>
          <p className="mt-2 text-3xl font-mono">
            ${(view.invoice.balanceCents / 100).toFixed(2)} {view.invoice.currency}
          </p>
        </header>

        {status === 'paid' ? (
          <div className="rounded bg-green-900/30 border border-green-700 p-4 text-green-200">
            Payment received. Thank you.
          </div>
        ) : (
          <>
            <div ref={mountRef} aria-label="Stripe payment form" className="min-h-32" />
            {errorMessage ? (
              <p className="text-red-400 text-sm" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={status !== 'ready'}
              className="w-full rounded bg-action px-4 py-3 text-white font-semibold disabled:opacity-50"
            >
              {status === 'loading'
                ? 'Loading…'
                : status === 'submitting'
                  ? 'Processing…'
                  : `Pay $${(view.invoice.balanceCents / 100).toFixed(2)}`}
            </button>
          </>
        )}

        <footer className="text-xs text-text-secondary-on-dark text-center">
          Secured by Stripe. Card information is sent directly to Stripe and never touches{' '}
          {view.tenant.name}'s servers.
        </footer>
      </div>
    </main>
  );
}
