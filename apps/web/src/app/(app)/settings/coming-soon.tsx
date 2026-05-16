/**
 * Shared "Coming soon" card used by every settings tab whose underlying
 * UI does not exist yet. Visual idiom matches ecosystem-placeholder.tsx
 * so the shell reads as native to the rest of the app.
 */
import type { JSX, ReactNode } from 'react';

interface Props {
  title: string;
  description: string;
  children?: ReactNode;
}

export function ComingSoonCard({ title, description, children }: Props): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <span className="inline-block rounded-full bg-bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          Coming soon
        </span>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {title}
        </h1>
      </header>
      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <p className="text-sm leading-relaxed text-text-primary-on-dark">{description}</p>
      </section>
      {children}
    </div>
  );
}
