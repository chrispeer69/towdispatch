/**
 * Shared layout for the three ecosystem placeholder pages. Renders inside the
 * standard authenticated app shell (no separate layout.tsx needed). The
 * accent color drives the title color and a subtle pill that calls out
 * "ecosystem product" so the page reads as part of a family.
 */
import type { CSSProperties, ReactNode } from 'react';

interface Props {
  productName: string;
  accentColor: string;
  description: string;
  children?: ReactNode;
}

export function EcosystemPlaceholder({
  productName,
  accentColor,
  description,
  children,
}: Props): JSX.Element {
  const titleStyle: CSSProperties = { color: accentColor };
  const pillStyle: CSSProperties = {
    backgroundColor: `${accentColor}26`,
    color: accentColor,
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <span
          className="inline-block rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={pillStyle}
        >
          Ecosystem product
        </span>
        <h1
          className="font-condensed text-4xl font-extrabold uppercase leading-none tracking-tight md:text-5xl"
          style={titleStyle}
        >
          {productName}
        </h1>
        <p className="text-sm text-text-secondary">Blue Collar AI ecosystem product.</p>
      </header>

      <section className="rounded-[14px] border border-steel-border bg-steel-mid p-5">
        <p className="text-sm leading-relaxed text-text-primary">{description}</p>
      </section>

      {children}
    </div>
  );
}
