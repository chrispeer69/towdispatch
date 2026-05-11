'use client';

import type { BreakdownPoint, TimeSeriesPoint } from '@towcommand/shared';
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

const BRAND = '#F05A1A';
const STEEL = '#1A1E2A';
const STEEL_BORDER = '#3A4158';
const TEXT_SECONDARY = '#9CA3B5';
const PIE_PALETTE = [
  '#F05A1A',
  '#FF7A3D',
  '#3B82F6',
  '#22C55E',
  '#EAB308',
  '#A855F7',
  '#EF4444',
  '#9CA3B5',
];

/**
 * TimeSeriesChart — line chart used by every report's primary series.
 * Two-series overlay: primary (orange) and an optional comparison line that
 * the reporter populates via comparisonValue.
 */
export function TimeSeriesChart({
  data,
  yLabel = '',
  comparisonLabel = 'Comparison',
}: {
  data: TimeSeriesPoint[];
  yLabel?: string;
  comparisonLabel?: string;
}): JSX.Element {
  if (data.length === 0) {
    return <EmptyChart label="No data in window" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid stroke={STEEL_BORDER} strokeDasharray="3 3" />
          <XAxis
            dataKey="bucket"
            stroke={TEXT_SECONDARY}
            tick={{ fill: TEXT_SECONDARY, fontSize: 11 }}
          />
          <YAxis
            stroke={TEXT_SECONDARY}
            tick={{ fill: TEXT_SECONDARY, fontSize: 11 }}
            label={{ value: yLabel, fill: TEXT_SECONDARY, angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: STEEL,
              border: `1px solid ${STEEL_BORDER}`,
              color: '#F0EDE8',
            }}
          />
          <Legend wrapperStyle={{ color: TEXT_SECONDARY }} />
          <Line
            type="monotone"
            dataKey="value"
            name="Primary"
            stroke={BRAND}
            strokeWidth={2}
            dot={false}
          />
          {data.some((d) => d.comparisonValue !== undefined && d.comparisonValue !== null) ? (
            <Line
              type="monotone"
              dataKey="comparisonValue"
              name={comparisonLabel}
              stroke="#3B82F6"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * BreakdownChart — bar chart for categorical splits when label cardinality
 * is small. For >8 categories we fall back to the pie palette automatically.
 */
export function BreakdownChart({
  data,
  yLabel = '',
}: {
  data: BreakdownPoint[];
  yLabel?: string;
}): JSX.Element {
  if (data.length === 0) {
    return <EmptyChart label="No breakdown data" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid stroke={STEEL_BORDER} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            stroke={TEXT_SECONDARY}
            tick={{ fill: TEXT_SECONDARY, fontSize: 10 }}
          />
          <YAxis
            stroke={TEXT_SECONDARY}
            tick={{ fill: TEXT_SECONDARY, fontSize: 11 }}
            label={{ value: yLabel, fill: TEXT_SECONDARY, angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: STEEL,
              border: `1px solid ${STEEL_BORDER}`,
              color: '#F0EDE8',
            }}
          />
          <Bar dataKey="value">
            {data.map((d, i) => (
              <Cell key={d.key} fill={paletteAt(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * SharePie — used for "share of revenue" style reports where pie shape
 * communicates better than bars.
 */
export function SharePie({ data }: { data: BreakdownPoint[] }): JSX.Element {
  if (data.length === 0) {
    return <EmptyChart label="No data" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              backgroundColor: STEEL,
              border: `1px solid ${STEEL_BORDER}`,
              color: '#F0EDE8',
            }}
          />
          <Pie data={data} dataKey="value" nameKey="label" outerRadius={100} label>
            {data.map((d, i) => (
              <Cell key={d.key} fill={paletteAt(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function paletteAt(i: number): string {
  return PIE_PALETTE[i % PIE_PALETTE.length] ?? '#F05A1A';
}

function EmptyChart({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-steel-border text-sm text-text-muted">
      {label}
    </div>
  );
}
