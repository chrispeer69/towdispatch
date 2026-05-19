/**
 * Shared building blocks for Help Center article bodies.
 *
 * Older articles each duplicated these primitives at the top of their
 * file (H2, P, Callout, etc.). New articles (and gradually older ones
 * during touch-ups) should import from here so the visual language stays
 * consistent and a single style tweak ripples everywhere.
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

export function H2({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-condensed mt-12 text-3xl font-extrabold uppercase tracking-tight text-text-primary-on-dark">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h3 className="font-condensed mt-8 text-xl font-extrabold uppercase tracking-wide text-text-primary-on-dark">
      {children}
    </h3>
  );
}

export function H4({ children }: { children: ReactNode }): JSX.Element {
  return <h4 className="mt-6 text-base font-semibold text-text-primary-on-dark">{children}</h4>;
}

export function P({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-4 text-sm leading-7 text-text-primary-on-dark/90">{children}</p>;
}

export function Em({ children }: { children: ReactNode }): JSX.Element {
  return <strong className="font-semibold text-text-primary-on-dark">{children}</strong>;
}

export function Code({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="rounded bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[12px] text-brand-primary">
      {children}
    </code>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'tip' | 'danger';
  title: string;
  children: ReactNode;
}): JSX.Element {
  const accent =
    tone === 'warning'
      ? 'border-status-warning/40 bg-status-warning/10'
      : tone === 'tip'
        ? 'border-ok/40 bg-ok/10'
        : tone === 'danger'
          ? 'border-danger/40 bg-danger/10'
          : 'border-info/40 bg-info/10';
  return (
    <div className={`mt-6 rounded-[10px] border ${accent} p-5`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
        {title}
      </p>
      <div className="mt-2 text-sm leading-7 text-text-primary-on-dark/90">{children}</div>
    </div>
  );
}

export function OrderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ol>
  );
}

export function UnorderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ul className="mt-4 list-disc space-y-3 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ul>
  );
}

export function RelatedDoc({ href, title }: { href: string; title: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="block rounded-[10px] border border-divider bg-bg-surface px-4 py-3 transition hover:border-brand-primary/40 hover:bg-bg-surface-elevated/30"
    >
      <span className="text-sm font-semibold text-text-primary-on-dark">{title}</span>
      <span className="ml-2 text-brand-primary">→</span>
    </Link>
  );
}

export function Table({
  head,
  rows,
}: {
  head: string[];
  rows: ReactNode[][];
}): JSX.Element {
  return (
    <div className="mt-6 overflow-x-auto rounded-[10px] border border-divider">
      <table className="w-full text-sm">
        <thead className="bg-bg-surface-elevated/40">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable row order
            <tr key={i} className="border-t border-divider">
              {r.map((cell, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable cell order
                <td key={j} className="px-4 py-2.5 align-top text-text-primary-on-dark/90">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }): JSX.Element {
  return (
    <ol className="mt-6 space-y-4">
      {items.map((step, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable step order
        <li key={i} className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Step {i + 1}
          </p>
          <p className="mt-1 text-base font-semibold text-text-primary-on-dark">{step.title}</p>
          <div className="mt-2 text-sm leading-7 text-text-primary-on-dark/90">{step.body}</div>
        </li>
      ))}
    </ol>
  );
}
