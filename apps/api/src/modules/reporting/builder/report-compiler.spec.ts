/**
 * Unit coverage for the report compiler (Session 53). Renders the compiled
 * drizzle SQL via PgDialect so we can assert on the exact parameterized text +
 * bound params — the security contract is "field exprs are allowlisted code,
 * filter VALUES always bind".
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { ReportCompileError, compileReport } from './report-compiler.js';

const dialect = new PgDialect();
const render = (q: ReturnType<typeof compileReport>['rowsSql']) => dialect.sqlToQuery(q);
const TENANT = '11111111-1111-1111-1111-111111111111';

function compile(over: Partial<Parameters<typeof compileReport>[0]> = {}) {
  return compileReport({
    baseEntity: 'jobs',
    selectedFields: ['job_number', 'status', 'rate_quoted_cents'],
    filters: [],
    groupBy: [],
    sort: [],
    tenantId: TENANT,
    limit: 100,
    ...over,
  });
}

describe('compileReport — projection + FROM/WHERE', () => {
  it('projects allowlisted fields with aliases and joins the registry relations', () => {
    const { rowsSql, columns } = compile();
    const { sql, params } = render(rowsSql);
    expect(sql).toContain('FROM jobs j');
    expect(sql).toContain('LEFT JOIN accounts a ON a.id = j.account_id');
    expect(sql).toContain('j.job_number AS "job_number"');
    expect(sql).toContain('j.rate_quoted_cents AS "rate_quoted_cents"');
    expect(sql).toContain('j.tenant_id = $1');
    expect(sql).toContain('j.deleted_at IS NULL');
    expect(sql).toContain('LIMIT');
    // tenant id is bound, never inlined.
    expect(params[0]).toBe(TENANT);
    expect(columns.map((c) => c.key)).toEqual(['job_number', 'status', 'rate_quoted_cents']);
  });

  it('fetches cap+1 rows so the caller can detect truncation', () => {
    const { sql, params } = render(compile({ limit: 50 }).rowsSql);
    expect(sql).toContain('LIMIT');
    expect(params).toContain(51);
  });
});

describe('compileReport — field allowlist (the security boundary)', () => {
  it('rejects an unknown base entity', () => {
    // @ts-expect-error — exercising the runtime guard with a bad entity.
    expect(() => compile({ baseEntity: 'secrets' })).toThrow(ReportCompileError);
  });

  it('rejects a selected field not in the registry', () => {
    expect(() => compile({ selectedFields: ['status', 'password_hash'] })).toThrow(
      ReportCompileError,
    );
  });

  it('rejects a filter on a field not in the registry', () => {
    expect(() => compile({ filters: [{ field: 'ssn', op: 'eq', value: 'x' }] })).toThrow(
      ReportCompileError,
    );
  });

  it('rejects a sort field not in the output columns', () => {
    expect(() => compile({ sort: [{ field: 'created_at', dir: 'asc' }] })).toThrow(
      ReportCompileError,
    );
  });
});

describe('compileReport — filter binding (no concatenation)', () => {
  it('binds an eq filter value as a parameter, not into the SQL text', () => {
    const { sql, params } = render(
      compile({ filters: [{ field: 'status', op: 'eq', value: 'completed' }] }).rowsSql,
    );
    expect(sql).toContain('j.status = $');
    expect(params).toContain('completed');
    expect(sql).not.toContain('completed');
  });

  it('binds IN as a bound comma list, never inlined', () => {
    const { sql, params } = render(
      compile({ filters: [{ field: 'status', op: 'in', value: ['completed', 'goa'] }] }).rowsSql,
    );
    expect(sql).toContain('j.status IN (');
    expect(params).toContain('completed');
    expect(params).toContain('goa');
    expect(sql).not.toContain('completed');
  });

  it('escapes LIKE wildcards in a contains filter', () => {
    const { params } = render(
      compile({ filters: [{ field: 'job_number', op: 'contains', value: '50%_x' }] }).rowsSql,
    );
    expect(params).toContain('%50\\%\\_x%');
  });

  it('rejects an empty IN array and a malformed between', () => {
    expect(() => compile({ filters: [{ field: 'status', op: 'in', value: [] }] })).toThrow(
      ReportCompileError,
    );
    expect(() =>
      compile({ filters: [{ field: 'rate_quoted_cents', op: 'between', value: [1] }] }),
    ).toThrow(ReportCompileError);
  });
});

describe('compileReport — grouping + sort', () => {
  it('emits GROUP BY + sum() for aggregatable fields and a row count', () => {
    const { rowsSql, columns } = compile({
      selectedFields: ['account_name', 'rate_quoted_cents'],
      groupBy: ['account_name'],
      sort: [{ field: 'rate_quoted_cents', dir: 'desc' }],
    });
    const { sql } = render(rowsSql);
    expect(sql).toContain('GROUP BY a.name');
    expect(sql).toContain('coalesce(sum(j.rate_quoted_cents), 0) AS "rate_quoted_cents"');
    expect(sql).toContain('count(*)::int AS "_count"');
    expect(sql).toContain('ORDER BY "rate_quoted_cents" DESC');
    expect(columns.map((c) => c.key)).toContain('_count');
  });

  it('rejects a non-aggregatable, non-grouped field in a grouped query', () => {
    expect(() =>
      compile({
        selectedFields: ['account_name', 'status'],
        groupBy: ['account_name'],
      }),
    ).toThrow(ReportCompileError);
  });

  it('defaults ORDER BY to the first column when no sort is given', () => {
    const { sql } = render(compile().rowsSql);
    expect(sql).toContain('ORDER BY "job_number" ASC');
  });
});

describe('compileReport — count query mirrors the filtered set', () => {
  it('wraps the same FROM/WHERE in a count(*) subquery', () => {
    const { sql } = render(compile().countSql);
    expect(sql).toContain('count(*)::int AS n');
    expect(sql).toContain('FROM jobs j');
  });
});
