/**
 * AI Smart Dispatch (Session 41) — Zod contracts barrel.
 *
 * Advisory candidate scoring (six weighted factors) + predictive ETA
 * (pluggable provider, heuristic v1) + a feedback loop (outcomes) and accuracy
 * reporting. Never auto-assigns. See SESSION_41_DECISIONS.md.
 */
export * from './factors';
export * from './eta';
export * from './recommendations';
export * from './outcomes';
export * from './reports';
