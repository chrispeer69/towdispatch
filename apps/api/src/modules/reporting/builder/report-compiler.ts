/**
 * Report compiler — turns a validated ReportTemplate into parameterized SQL.
 *
 * Security contract:
 *   - Every projected/grouped/sorted/filtered field is resolved through the
 *     entity registry; an unknown key throws ReportCompileError (→ 400). There
 *     is no `select *` and no raw-SQL path.
 *   - Field SQL exprs come from the registry (code constants) and are inlined
 *     via sql.raw. Filter VALUES are always bound as parameters via the drizzle
 *     `sql` template — never string-concatenated.
 *
 * Pure (no NestJS, no DB handle) so it is unit-testable in isolation.
 */
import type {
  ReportBaseEntity,
  ReportFieldKind,
  ReportFilter,
  ReportSort,
} from '@ustowdispatch/shared';
import { type SQL, sql } from 'drizzle-orm';
import { ENTITY_REGISTRY, type EntityDef, type RegistryField } from './entity-registry.js';

export class ReportCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportCompileError';
  }
}

export interface CompiledColumn {
  key: string;
  label: string;
  kind: ReportFieldKind;
}

export interface CompiledReport {
  columns: CompiledColumn[];
  /** SELECT … LIMIT cap+1 (the +1 lets the caller detect truncation). */
  rowsSql: SQL;
  /** SELECT count(*) over the same FROM/WHERE(/GROUP BY) for an exact total. */
  countSql: SQL;
}

export interface CompileInput {
  baseEntity: ReportBaseEntity;
  selectedFields: string[];
  filters: ReportFilter[];
  groupBy: string[];
  sort: ReportSort[];
  tenantId: string;
  /** Row cap; the rows query fetches cap+1. */
  limit: number;
}

const SCALAR_OPS: Record<string, string> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

export function compileReport(input: CompileInput): CompiledReport {
  const def = ENTITY_REGISTRY[input.baseEntity];
  if (!def) throw new ReportCompileError(`Unknown base entity: ${input.baseEntity}`);
  if (input.selectedFields.length === 0) {
    throw new ReportCompileError('selectedFields must not be empty');
  }

  const sel = input.selectedFields.map((key) => ({ key, meta: requireField(def, key) }));
  const grouped = input.groupBy.length > 0;

  // ---- FROM / WHERE (shared by rows + count) ----
  const joinSql = def.joins.length ? sql.raw(` ${def.joins.join(' ')}`) : sql.raw('');
  const preds: SQL[] = [sql`${sql.raw(def.tenantCol)} = ${input.tenantId}::uuid`];
  if (def.deletedCol) preds.push(sql`${sql.raw(def.deletedCol)} IS NULL`);
  for (const filter of input.filters) preds.push(compileFilter(def, filter));
  const fromWhere = sql`FROM ${sql.raw(def.from)}${joinSql} WHERE ${sql.join(preds, sql` AND `)}`;

  // ---- SELECT list + output columns ----
  const columns: CompiledColumn[] = [];
  const selectFrags: SQL[] = [];

  if (!grouped) {
    for (const { key, meta } of sel) {
      selectFrags.push(sql`${sql.raw(meta.expr)} AS ${sql.identifier(key)}`);
      columns.push({ key, label: meta.label, kind: meta.kind });
    }
  } else {
    const groupFields = input.groupBy.map((key) => {
      const meta = requireField(def, key);
      if (!meta.groupable) throw new ReportCompileError(`Field not groupable: ${key}`);
      return { key, meta };
    });
    const groupKeys = new Set(groupFields.map((g) => g.key));
    for (const { key, meta } of groupFields) {
      selectFrags.push(sql`${sql.raw(meta.expr)} AS ${sql.identifier(key)}`);
      columns.push({ key, label: meta.label, kind: meta.kind });
    }
    for (const { key, meta } of sel) {
      if (groupKeys.has(key)) continue;
      if (!meta.aggregatable) {
        throw new ReportCompileError(
          `Field '${key}' must be in group_by or be aggregatable when grouping`,
        );
      }
      selectFrags.push(sql`coalesce(sum(${sql.raw(meta.expr)}), 0) AS ${sql.identifier(key)}`);
      columns.push({ key, label: meta.label, kind: meta.kind });
    }
    selectFrags.push(sql`count(*)::int AS ${sql.identifier('_count')}`);
    columns.push({ key: '_count', label: 'Count', kind: 'number' });
  }

  const groupSql = grouped
    ? sql` GROUP BY ${sql.join(
        input.groupBy.map((k) => sql.raw(requireField(def, k).expr)),
        sql`, `,
      )}`
    : sql.raw('');

  // ---- ORDER BY (output aliases; default to first column) ----
  const outKeys = new Set(columns.map((c) => c.key));
  const orderFrags: SQL[] = [];
  for (const s of input.sort) {
    if (!outKeys.has(s.field)) {
      throw new ReportCompileError(`Sort field not in output columns: ${s.field}`);
    }
    orderFrags.push(sql`${sql.identifier(s.field)} ${sql.raw(s.dir === 'desc' ? 'DESC' : 'ASC')}`);
  }
  if (orderFrags.length === 0 && columns[0]) {
    orderFrags.push(sql`${sql.identifier(columns[0].key)} ASC`);
  }
  const orderSql = orderFrags.length
    ? sql` ORDER BY ${sql.join(orderFrags, sql`, `)}`
    : sql.raw('');

  const rowsSql = sql`SELECT ${sql.join(selectFrags, sql`, `)} ${fromWhere}${groupSql}${orderSql} LIMIT ${input.limit + 1}`;

  const countInner = grouped ? sql`SELECT 1 ${fromWhere}${groupSql}` : sql`SELECT 1 ${fromWhere}`;
  const countSql = sql`SELECT count(*)::int AS n FROM (${countInner}) sub`;

  return { columns, rowsSql, countSql };
}

function requireField(def: EntityDef, key: string): RegistryField {
  const meta = def.fields[key];
  if (!meta) throw new ReportCompileError(`Field not allowed: ${def.entity}.${key}`);
  return meta;
}

function compileFilter(def: EntityDef, filter: ReportFilter): SQL {
  const meta = def.fields[filter.field];
  if (!meta) throw new ReportCompileError(`Filter field not allowed: ${filter.field}`);
  const col = sql.raw(meta.expr);

  switch (filter.op) {
    case 'is_null':
      return sql`${col} IS NULL`;
    case 'not_null':
      return sql`${col} IS NOT NULL`;
    case 'in': {
      const arr = filter.value;
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new ReportCompileError(`'in' requires a non-empty array for ${filter.field}`);
      }
      // drizzle expands an interpolated array into a bound comma list: IN ($n, $m).
      return sql`${col} IN (${arr})`;
    }
    case 'between': {
      const v = filter.value;
      if (!Array.isArray(v) || v.length !== 2) {
        throw new ReportCompileError(`'between' requires [min, max] for ${filter.field}`);
      }
      const [lo, hi] = v;
      if (lo === undefined || hi === undefined) {
        throw new ReportCompileError(`'between' requires [min, max] for ${filter.field}`);
      }
      return sql`${col} BETWEEN ${bind(meta.kind, lo)} AND ${bind(meta.kind, hi)}`;
    }
    case 'contains': {
      if (typeof filter.value !== 'string') {
        throw new ReportCompileError(`'contains' requires a string for ${filter.field}`);
      }
      return sql`${col} ILIKE ${`%${escapeLike(filter.value)}%`}`;
    }
    default: {
      const op = SCALAR_OPS[filter.op];
      if (!op) throw new ReportCompileError(`Unsupported operator: ${filter.op}`);
      if (filter.value === undefined || filter.value === null || Array.isArray(filter.value)) {
        throw new ReportCompileError(`'${filter.op}' requires a scalar value for ${filter.field}`);
      }
      return sql`${col} ${sql.raw(op)} ${bind(meta.kind, filter.value)}`;
    }
  }
}

/** Cast a bound value to the field's type so comparisons are well-typed. */
function bind(kind: ReportFieldKind, value: string | number | boolean): SQL {
  switch (kind) {
    case 'date':
      return sql`${value}::timestamptz`;
    case 'boolean':
      return sql`${value}::boolean`;
    case 'cents':
    case 'number':
      return sql`${value}::numeric`;
    default:
      return sql`${value}`;
  }
}

/** Escape LIKE metacharacters so a user filter can't inject wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
}
