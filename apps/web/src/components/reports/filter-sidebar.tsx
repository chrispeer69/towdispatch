'use client';
import type { JSX } from 'react';
import { useState } from 'react';

export interface FilterState {
  from: string; // ISO date (yyyy-mm-dd)
  to: string;
  granularity: 'day' | 'week' | 'month';
  comparison: 'none' | 'prior_period' | 'prior_year';
}

const today = (): string => new Date().toISOString().slice(0, 10);
const startOfMonth = (): string => {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
};

export const DEFAULT_FILTERS: FilterState = {
  from: startOfMonth(),
  to: today(),
  granularity: 'day',
  comparison: 'none',
};

export function FilterSidebar({
  initial,
  onApply,
  onSave,
  onExportCsv,
  onExportPdf,
}: {
  initial?: Partial<FilterState>;
  onApply: (state: FilterState) => void;
  onSave: (state: FilterState) => Promise<void> | void;
  onExportCsv: (state: FilterState) => Promise<void> | void;
  onExportPdf: (state: FilterState) => Promise<void> | void;
}): JSX.Element {
  const [state, setState] = useState<FilterState>({ ...DEFAULT_FILTERS, ...initial });
  return (
    <aside
      className="rounded-md border border-steel-border bg-steel-mid/40 p-4"
      data-testid="filter-sidebar"
    >
      <h2 className="mb-3 font-condensed text-sm uppercase tracking-wide text-text-secondary">
        Filters
      </h2>
      <div className="space-y-3">
        <label className="block text-xs">
          <span className="text-text-secondary">From</span>
          <input
            type="date"
            value={state.from}
            onChange={(e) => setState({ ...state, from: e.target.value })}
            className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="block text-xs">
          <span className="text-text-secondary">To</span>
          <input
            type="date"
            value={state.to}
            onChange={(e) => setState({ ...state, to: e.target.value })}
            className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <label className="block text-xs">
          <span className="text-text-secondary">Granularity</span>
          <select
            value={state.granularity}
            onChange={(e) =>
              setState({ ...state, granularity: e.target.value as FilterState['granularity'] })
            }
            className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1 text-sm text-text-primary"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-text-secondary">Compare to</span>
          <select
            value={state.comparison}
            onChange={(e) =>
              setState({ ...state, comparison: e.target.value as FilterState['comparison'] })
            }
            className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1 text-sm text-text-primary"
          >
            <option value="none">No comparison</option>
            <option value="prior_period">Prior period</option>
            <option value="prior_year">Prior year</option>
          </select>
        </label>

        <button
          type="button"
          className="w-full rounded-md bg-orange px-3 py-2 text-sm font-bold uppercase tracking-wide text-white hover:bg-orange-light"
          onClick={() => onApply(state)}
        >
          Apply
        </button>
      </div>

      <div className="my-4 h-px bg-steel-border" />

      <div className="space-y-2">
        <button
          type="button"
          className="w-full rounded-md border border-steel-border bg-steel-light/40 px-3 py-2 text-xs uppercase tracking-wide text-text-primary hover:bg-steel-light"
          onClick={() => onExportCsv(state)}
          data-testid="export-csv"
        >
          Export CSV
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-steel-border bg-steel-light/40 px-3 py-2 text-xs uppercase tracking-wide text-text-primary hover:bg-steel-light"
          onClick={() => onExportPdf(state)}
          data-testid="export-pdf"
        >
          Export PDF
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-steel-border bg-steel-light/40 px-3 py-2 text-xs uppercase tracking-wide text-text-primary hover:bg-steel-light"
          onClick={() => onSave(state)}
          data-testid="save-report"
        >
          Save & schedule…
        </button>
      </div>
    </aside>
  );
}
