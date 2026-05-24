/**
 * Fraud Detection (Session 43) — Zod contracts barrel.
 *
 * Defensive analytics: scores each job's fraud/dispute risk before invoice
 * submission and logs motor-club disputes with ground-truth feedback. See
 * SESSION_43_DECISIONS.md for signal weights + band thresholds.
 */
export * from './signals';
export * from './scores';
export * from './disputes';
export * from './outcomes';
export * from './detail';
