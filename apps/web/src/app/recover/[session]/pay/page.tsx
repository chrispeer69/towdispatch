'use client';
import { detectRecoverLocale, recoverMessages } from '@/lib/recover/i18n';
import { startPayment } from '@/lib/recover/recover-client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

const STRIPE_JS_SRC = 'https://js.stripe.com/v3/';

interface StripeElement {
  mount(sel: string | HTMLElement): void;
  unmount(): void;
}
interface StripeElements {
  create(type: 'payment'): StripeElement;
  getElement(type: 'payment'): StripeElement | null;
  submit(): Promise<{ error?: { message?: string } }>;
}
interface StripeJs {
  elements(opts: { clientSecret: string }): StripeElements;
  confirmPayment(opts: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required';
  }): Promise<{ error?: { message?: string } }>;
}
declare global {
  interface Window {
    Stripe?: (publishableKey: string, options?: { stripeAccount?: string }) => StripeJs;
  }
}

export default function RecoverPayPage(): JSX.Element {
  const t = useMemo(() => recoverMessages(detectRecoverLocale()), []);
  const router = useRouter();
  const params = useParams<{ session: string }>();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'paid' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

    void (async () => {
      try {
        const init = await startPayment();
        if (cancelled) return;
        if (!init.clientSecret || !init.publishableKey) {
          throw new Error('Online payment is not available for this yard.');
        }
        await ensureStripe();
        if (cancelled || !window.Stripe) return;
        const stripe = init.stripeAccountId
          ? window.Stripe(init.publishableKey, { stripeAccount: init.stripeAccountId })
          : window.Stripe(init.publishableKey);
        const elements = stripe.elements({ clientSecret: init.clientSecret });
        const card = elements.create('payment');
        if (mountRef.current) card.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      elementsRef.current?.getElement('payment')?.unmount();
    };
  }, []);

  const submit = async (): Promise<void> => {
    setStatus('submitting');
    setError(null);
    try {
      const stripe = stripeRef.current;
      const elements = elementsRef.current;
      if (!stripe || !elements) throw new Error('Stripe not ready');
      const s = await elements.submit();
      if (s.error) throw new Error(s.error.message ?? 'submit failed');
      const r = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/recover/${params.session}/release`,
        },
        redirect: 'if_required',
      });
      if (r.error) throw new Error(r.error.message ?? t.payError);
      setStatus('paid');
      router.replace(`/recover/${params.session}/release`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.payError);
      setStatus('error');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t.payNow}</h1>
      <div ref={mountRef} className="rounded-lg border border-slate-200 bg-white p-3" />
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={status !== 'ready' && status !== 'error'}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {status === 'submitting' ? t.paying : t.payNow}
      </button>
    </div>
  );
}
