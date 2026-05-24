/**
 * Retention policy — the pure, DB-free heart of the ai-dispatch retention
 * sweep (chore/ai-dispatch-retention).
 *
 * Three high-volume tables from Session 41 accumulate forever without this.
 * Each gets a two-phase, age-based (created_at) lifecycle:
 *   - SOFT phase: a live row older than `softDeleteDays` gets deleted_at set.
 *   - HARD phase: a soft-deleted row older than `hardDeleteDays` is purged.
 *
 * Windows are deliberate per table (NOT a uniform soft+30) — see rationale on
 * each entry and AI_DISPATCH_RETENTION_DECISIONS.md. They are code constants,
 * not env vars: changing a statutory-ish data-lifetime should be a reviewed
 * code change, never an ops toggle.
 *
 * `classifyRow` is the single source of truth for what happens to one row;
 * the SQL in RetentionService implements exactly these predicates, and the
 * unit tests pin the boundaries here.
 */

export type RetentionTable = 'dispatch_recommendations' | 'dispatch_outcomes' | 'eta_predictions';

export interface RetentionPolicy {
  readonly table: RetentionTable;
  /** Age (days, by created_at) at which a live row is soft-deleted. */
  readonly softDeleteDays: number;
  /** Age (days, by created_at) at which a soft-deleted row is purged. */
  readonly hardDeleteDays: number;
  readonly rationale: string;
}

export const RETENTION_POLICIES: Readonly<Record<RetentionTable, RetentionPolicy>> = {
  dispatch_recommendations: {
    table: 'dispatch_recommendations',
    softDeleteDays: 30,
    hardDeleteDays: 60,
    rationale: 'Advisory recommendation sets churn fast and are re-derived constantly.',
  },
  dispatch_outcomes: {
    table: 'dispatch_outcomes',
    softDeleteDays: 365,
    hardDeleteDays: 730,
    rationale: 'Feedback/training signal — kept a year live, two years total.',
  },
  eta_predictions: {
    table: 'eta_predictions',
    softDeleteDays: 90,
    hardDeleteDays: 180,
    rationale: 'ETA-accuracy reports default to a 90-day window; keep one window live.',
  },
} as const;

export const RETENTION_TABLES: readonly RetentionTable[] = Object.keys(
  RETENTION_POLICIES,
) as RetentionTable[];

const MS_PER_DAY = 86_400_000;

export interface RetentionCutoffs {
  /** Live rows created strictly before this are soft-delete-eligible. */
  readonly softCutoff: Date;
  /** Soft-deleted rows created strictly before this are purge-eligible. */
  readonly hardCutoff: Date;
}

/** Pure: derive the two cutoff instants for a policy at a given `now`. */
export function retentionCutoffs(policy: RetentionPolicy, now: Date): RetentionCutoffs {
  return {
    softCutoff: new Date(now.getTime() - policy.softDeleteDays * MS_PER_DAY),
    hardCutoff: new Date(now.getTime() - policy.hardDeleteDays * MS_PER_DAY),
  };
}

export type RetentionAction = 'keep' | 'soft_delete' | 'hard_delete';

/**
 * Pure classifier for a single row. Mirrors the RetentionService SQL exactly:
 *   - hard_delete : already soft-deleted AND created before the hard cutoff.
 *   - soft_delete : still live        AND created before the soft cutoff.
 *   - keep        : everything else (including rows exactly at a cutoff — the
 *                   comparison is strict `<`, matching `created_at < $cutoff`).
 *
 * The two phases are disjoint in any one run: HARD only touches already-
 * soft-deleted rows, SOFT only touches live rows. A live row past the hard age
 * is therefore soft-deleted on this pass and purged on the next — the
 * guaranteed grace period.
 */
export function classifyRow(
  row: { readonly createdAt: Date; readonly deletedAt: Date | null },
  cutoffs: RetentionCutoffs,
): RetentionAction {
  if (row.deletedAt !== null) {
    return row.createdAt.getTime() < cutoffs.hardCutoff.getTime() ? 'hard_delete' : 'keep';
  }
  return row.createdAt.getTime() < cutoffs.softCutoff.getTime() ? 'soft_delete' : 'keep';
}
