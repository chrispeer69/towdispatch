/**
 * DI token for the damage-analysis vision provider. Bound by a factory in
 * damage-analysis.module.ts that selects the stub (default) or a live
 * provider (anthropic | openai) from DAMAGE_ANALYSIS_PROVIDER, refusing to
 * boot in a live mode with no API key (mirrors the payments cutover guard).
 */
export const DAMAGE_PROVIDER = Symbol.for('damage-analysis.DamageProvider');
