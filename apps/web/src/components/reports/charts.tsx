'use client';
/**
 * Chart components — Recharts wrappers themed to match TowCommand.
 *
 * Color tokens are mirrored from tailwind.config.ts; we don't have a hook
 * for Tailwind tokens in client components, so the hex values are inlined.
 */
import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const ORANGE = '#F05A1A';
const STEEL_BORDER = '#3A4158';
const TEXT_SECONDARY = '#9CA3B5';
const TEXT_PRIMARY = '#F0EDE8';
const PRIOR_GRAY = '#626882';
const PIE_PALETTE = ['#F05A1A', '#FAB005', '#37B24D', '#1C7ED6', '#7048E8', '#D6336C', '#0CA678', '#FA5252'];

interface TimePoint {
  bucket: string;
  value: number;
  priorValue?: number | null;
}

export function ReportLineChart({
  data,
  title,
  unit,
}: {
  data: TimePoint[];
  title?: string;
  unit?: 'cents' | 'count' | 'percent';
}): JSX.Element {
  const series = data.map((d) => ({
    bucket: d.bucket,
    value: unit === 'cents' ? d.value / 100 : d.value,
    priorValue: d.priorValue == null ? null : unit === 'cents' ? d.priorValue / 100 : d.priorValue,
  }));
  return (
    <div className="rounded-md border border-steel-border bg-steel-mid/40 p-4" data-testid="report-line-chart">
      {title ? (
        <h3 className="mb-3 font-condensed text-sm uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
      ) : null}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={STEEL_BORDER} strokeDasharray="3 3" />
          <XAxis dataKey="bucket" stroke={TEXT_SECONDARY} fontSize={11} />
          <YAxis stroke={TEXT_SECONDARY} fontSize={11} width={64} tickFormatter={(v) => formatAxis(v, unit)} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1A1E2A', border: `1px solid ${STEEL_BORDER}`, color: TEXT_PRIMARY }}
            formatter={(value: number) => formatAxis(value, unit)}
          />
          <Legend wrapperStyle={{ color: TEXT_SECONDARY, fontSize: 11 }} />
          <Line type="monotone" dataKey="value" name="Current" stroke={ORANGE} strokeWidth={2} dot={false} />
          {series.some((d) => d.priorValue != null) ? (
            <Line
              type="monotone"
              dataKey="priorValue"
              name="Prior"
              stroke={PRIOR_GRAY}
              strokeDasharray="4 4"
              strokeWidth={2}
              dot={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface BarPoint {
  label: string;
  value: number;
}

export function ReportBarChart({
  data,
  title,
  unit,
}: {
  data: BarPoint[];
  title?: string;
  unit?: 'cents' | 'count' | 'percent';
}): JSX.Element {
  const series = data.map((d) => ({
    label: d.label,
    value: unit === 'cents' ? d.value / 100 : d.value,
  }));
  return (
    <div className="rounded-md border border-steel-border bg-steel-mid/40 p-4" data-testid="report-bar-chart">
      {title ? (
        <h3 className="mb-3 font-condensed text-sm uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
      ) : null}
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={STEEL_BORDER} strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke={TEXT_SECONDARY} fontSize={11} />
          <YAxis stroke={TEXT_SECONDARY} fontSize={11} width={64} tickFormatter={(v) => formatAxis(v, unit)} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1A1E2A', border: `1px solid ${STEEL_BORDER}`, color: TEXT_PRIMARY }}
            formatter={(value: number) => formatAxis(value, unit)}
          />
          <Bar dataKey="value" fill={ORANGE} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface PiePoint {
  label: string;
  value: number;
}

export function ReportPieChart({
  data,
  title,
}: {
  data: PiePoint[];
  title?: string;
}): JSX.Element {
  return (
    <div className="rounded-md border border-steel-border bg-steel-mid/40 p-4" data-testid="report-pie-chart">
      {title ? (
        <h3 className="mb-3 font-condensed text-sm uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
      ) : null}
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Tooltip
            contentStyle={{ backgroundColor: '#1A1E2A', border: `1px solid ${STEEL_BORDER}`, color: TEXT_PRIMARY }}
          />
          <Pie data={data} dataKey="value" nameKey="label" outerRadius={90} stroke={STEEL_BORDER}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ color: TEXT_SECONDARY, fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatAxis(v: number, unit?: 'cents' | 'count' | 'percent'): string {
  if (unit === 'percent') return `${Math.round(v * 100)}%`;
  if (unit === 'cents') return `$${(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return v.toLocaleString();
}
