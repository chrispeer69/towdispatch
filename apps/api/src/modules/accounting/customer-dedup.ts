/**
 * Customer dedup rules for accounting sync.
 *
 * QuickBooks (and most accounting back-ends) treats customers as global
 * within the company file, so blindly creating a new customer for every
 * Tow Dispatch customer would lead to duplicates the operator has to merge
 * by hand. The rule is intentionally narrow:
 *
 *   1. Exact (normalized) email match — strongest signal.
 *   2. Exact (digits-only) phone match — second strongest.
 *   3. Exact (case-folded, whitespace-collapsed) display name match — third.
 *
 * Any rule firing returns the candidate's externalId. The first rule that
 * matches wins; we do not try fuzzy/Levenshtein because false positives are
 * unrecoverable (a wrong merge can mis-attribute revenue).
 */
export interface DedupCandidate {
  externalId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface DedupInput {
  displayName: string;
  email: string | null;
  phone: string | null;
}

const normalizeEmail = (e: string | null): string | null => (e ? e.trim().toLowerCase() : null);

const normalizePhone = (p: string | null): string | null => {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
};

const normalizeName = (n: string): string => n.trim().toLowerCase().replace(/\s+/g, ' ');

export function findDuplicate(
  input: DedupInput,
  candidates: readonly DedupCandidate[],
): DedupCandidate | null {
  const inEmail = normalizeEmail(input.email);
  const inPhone = normalizePhone(input.phone);
  const inName = normalizeName(input.displayName);

  if (inEmail) {
    const m = candidates.find((c) => normalizeEmail(c.email) === inEmail);
    if (m) return m;
  }
  if (inPhone) {
    const m = candidates.find((c) => normalizePhone(c.phone) === inPhone);
    if (m) return m;
  }
  if (inName) {
    const m = candidates.find((c) => normalizeName(c.displayName) === inName);
    if (m) return m;
  }
  return null;
}
