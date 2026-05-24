'use client';

/**
 * Small, self-contained presentational primitives for the customer portal
 * (Session 32). Deliberately NOT the staff design-system components — the
 * portal renders a neutral white/tenant-accent theme, so these use plain
 * Tailwind + the --portal-primary CSS variable injected by the portal layout.
 */
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type JSX,
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
  useId,
} from 'react';

export function PortalCard({
  title,
  children,
}: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="mb-5 text-lg font-bold text-neutral-900">{title}</h1>
      {children}
    </div>
  );
}

export function PortalField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  // Generate an id and inject it into the control so the <label> is explicitly
  // associated (htmlFor) — accessible and statically verifiable.
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {control}
    </div>
  );
}

export function PortalInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      {...props}
      className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 disabled:opacity-50"
    />
  );
}

export function PortalPrimaryButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...props}
      style={{ backgroundColor: 'var(--portal-primary)' }}
      className="inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function PortalNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
}): JSX.Element {
  const cls =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'success'
        ? 'border-green-200 bg-green-50 text-green-700'
        : 'border-neutral-200 bg-neutral-50 text-neutral-600';
  return (
    <div role="alert" className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}
