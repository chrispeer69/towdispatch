/**
 * Minimal RFC 7644 §3.4.2.2 SCIM filter parser.
 *
 * v1 scope: the `eq` operator and top-level `and` conjunction only — which
 * is what Okta / Azure AD / OneLogin actually send for the
 * `userName eq "x"` / `externalId eq "y"` provisioning lookups. Anything
 * richer (or, co, sw, pr, parentheses, value-path) is reported as
 * `supported: false` so the caller can log it and degrade gracefully
 * (return the unfiltered page) rather than 500.
 *
 * Pure + dependency-free for unit testing.
 */

export interface ScimEqClause {
  attribute: string;
  value: string | boolean | number;
}

export type ScimFilterParse =
  | { supported: true; clauses: ScimEqClause[] }
  | { supported: false; reason: string };

// `attr eq <value>` where value is "quoted", true, false, or a number.
const CLAUSE_RX = /^([\w$.:-]+)\s+(\w+)\s+(.+)$/;

function parseValue(raw: string): string | boolean | number | undefined {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    // Unescape \" and \\ per JSON string rules (SCIM values are JSON strings).
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

export function parseScimFilter(filter: string | undefined | null): ScimFilterParse {
  if (!filter || filter.trim().length === 0) {
    return { supported: true, clauses: [] };
  }
  const raw = filter.trim();
  if (raw.includes('(') || raw.includes('[')) {
    return { supported: false, reason: 'grouping/value-path not supported' };
  }
  if (/\bor\b/i.test(raw)) {
    return { supported: false, reason: 'or not supported' };
  }

  // Split on top-level ` and ` (case-insensitive). No parens in v1, so a
  // flat split is safe.
  const parts = raw.split(/\s+and\s+/i);
  const clauses: ScimEqClause[] = [];
  for (const part of parts) {
    const m = CLAUSE_RX.exec(part.trim());
    if (!m) return { supported: false, reason: `unparseable clause: ${part.trim()}` };
    const [, attribute, op, valueRaw] = m;
    if (!attribute || !op || valueRaw === undefined) {
      return { supported: false, reason: `unparseable clause: ${part.trim()}` };
    }
    if (op.toLowerCase() !== 'eq') {
      return { supported: false, reason: `operator not supported: ${op}` };
    }
    const value = parseValue(valueRaw);
    if (value === undefined) {
      return { supported: false, reason: `unparseable value: ${valueRaw}` };
    }
    clauses.push({ attribute, value });
  }
  return { supported: true, clauses };
}

/** Convenience: pull the value of the first `eq` clause on `attribute`. */
export function findEqValue(
  parse: ScimFilterParse,
  attribute: string,
): string | boolean | number | undefined {
  if (!parse.supported) return undefined;
  return parse.clauses.find((c) => c.attribute.toLowerCase() === attribute.toLowerCase())?.value;
}
