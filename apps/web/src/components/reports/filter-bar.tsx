'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * FilterBar — date window + comparison + (optional) dimension filters.
 * Pushes URL search params on submit so reports stay bookmarkable + server-
 * renderable. Each detail page passes the dimension fields it cares about
 * (e.g. revenue passes ['accountId', 'source']) and the bar renders only
 * those plus the always-present date controls.
 */
export function FilterBar({
  dimensions = [],
  initial = {},
}: {
  dimensions?: Array<{ key: string; label: string; type?: 'text' }>;
  initial?: Record<string, string>;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(true);

  const get = (k: string): string => initial[k] ?? search.get(k) ?? '';

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const s = String(v);
      if (s.length > 0) params.set(k, s);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <aside className="rounded-lg border border-steel-border bg-steel-mid/40">
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider">Filters</h2>
        <button
          type="button"
          className="text-xs text-text-secondary hover:text-text-primary"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </header>
      {open ? (
        <form className="space-y-3 px-3 pb-3" onSubmit={onSubmit}>
          <FilterInput
            name="fromDate"
            label="From"
            type="date"
            defaultValue={dateOnly(get('fromDate'))}
          />
          <FilterInput
            name="toDate"
            label="To"
            type="date"
            defaultValue={dateOnly(get('toDate'))}
          />
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Compare</span>
            <select
              name="comparison"
              defaultValue={get('comparison') || 'none'}
              className="mt-1 w-full rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm"
            >
              <option value="none">None</option>
              <option value="prior_period">Prior period</option>
              <option value="prior_year">Prior year</option>
            </select>
          </label>
          {dimensions.map((d) => (
            <FilterInput
              key={d.key}
              name={d.key}
              label={d.label}
              type={d.type ?? 'text'}
              defaultValue={get(d.key)}
            />
          ))}
          <button
            type="submit"
            className="w-full rounded-md bg-orange px-3 py-2 text-sm font-medium text-white hover:bg-orange-light"
          >
            Apply
          </button>
        </form>
      ) : null}
    </aside>
  );
}

function FilterInput({
  name,
  label,
  type,
  defaultValue,
}: {
  name: string;
  label: string;
  type: string;
  defaultValue?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded border border-steel-border bg-steel-mid px-2 py-1.5 text-sm text-text-primary"
      />
    </label>
  );
}

function dateOnly(iso: string): string {
  if (!iso) return '';
  if (iso.length <= 10) return iso;
  return iso.slice(0, 10);
}
