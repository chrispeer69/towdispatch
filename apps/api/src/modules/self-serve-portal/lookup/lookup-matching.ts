/**
 * Pure vehicle-lookup matching + masking (Session 55).
 *
 * Kept free of NestJS / DB so the match-quality rules are unit-tested in
 * isolation and the service layer and the SQL filter share exactly one
 * definition of "what matches". A lookup never leaks full vehicle data: on a
 * multi-match we return masked previews; only a single match proceeds to a
 * magic link. See SESSION_55_DECISIONS.md.
 */
import type { PortalLookupMatch, PortalLookupPayload } from '@ustowdispatch/shared';

export interface LookupCandidate {
  impoundId: string;
  caseNumber: string;
  licensePlate: string | null;
  vehicleVin: string | null;
  ownerLastName: string | null;
}

export interface NormalizedLookupQuery {
  plate?: string;
  vin?: string;
  caseNumber?: string;
  lastName?: string;
}

/** Plates compare case-insensitively and ignore spaces/dashes; VIN/case upper-cased. */
function canonPlate(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, '');
}

export function normalizeLookupQuery(q: PortalLookupPayload): NormalizedLookupQuery {
  const out: NormalizedLookupQuery = {};
  if (q.plate?.trim()) out.plate = canonPlate(q.plate.trim());
  if (q.vin?.trim()) out.vin = q.vin.trim().toUpperCase();
  if (q.caseNumber?.trim()) out.caseNumber = q.caseNumber.trim().toUpperCase();
  if (q.lastName?.trim()) out.lastName = q.lastName.trim().toLowerCase();
  return out;
}

/**
 * A candidate matches when EVERY supplied query field matches (AND). VIN match
 * is a suffix match (owners often have only the last 8). Empty query never
 * matches (the schema requires ≥1 field, but guard anyway).
 */
export function candidateMatches(c: LookupCandidate, q: NormalizedLookupQuery): boolean {
  const fields = [q.plate, q.vin, q.caseNumber, q.lastName];
  if (fields.every((f) => f === undefined)) return false;
  if (q.plate !== undefined) {
    if (!c.licensePlate || canonPlate(c.licensePlate) !== q.plate) return false;
  }
  if (q.vin !== undefined) {
    const vin = c.vehicleVin?.toUpperCase();
    if (!vin || !(vin === q.vin || vin.endsWith(q.vin))) return false;
  }
  if (q.caseNumber !== undefined) {
    if (c.caseNumber.toUpperCase() !== q.caseNumber) return false;
  }
  if (q.lastName !== undefined) {
    if (!c.ownerLastName || c.ownerLastName.toLowerCase() !== q.lastName) return false;
  }
  return true;
}

export function maskTail(value: string | null, visible = 4): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= visible) return `***${v}`;
  return `***${v.slice(-visible)}`;
}

export function toMaskedMatch(c: LookupCandidate): PortalLookupMatch {
  return {
    impoundId: c.impoundId,
    maskedCase: maskTail(c.caseNumber) ?? '***',
    maskedPlate: maskTail(c.licensePlate),
    maskedVin: maskTail(c.vehicleVin),
  };
}

export type LookupClassification =
  | { kind: 'none'; single: null; masked: [] }
  | { kind: 'single'; single: LookupCandidate; masked: [] }
  | { kind: 'multi'; single: null; masked: PortalLookupMatch[] };

/** Classify the matched rows into none / single / multi (with masked previews). */
export function classifyMatches(matched: LookupCandidate[]): LookupClassification {
  if (matched.length === 0) return { kind: 'none', single: null, masked: [] };
  if (matched.length === 1)
    return { kind: 'single', single: matched[0] as LookupCandidate, masked: [] };
  return { kind: 'multi', single: null, masked: matched.map(toMaskedMatch) };
}

/** Convenience: filter candidates by a raw query and classify in one call. */
export function runLookup(
  candidates: LookupCandidate[],
  query: PortalLookupPayload,
): LookupClassification {
  const norm = normalizeLookupQuery(query);
  return classifyMatches(candidates.filter((c) => candidateMatches(c, norm)));
}
