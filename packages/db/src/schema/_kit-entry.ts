/**
 * Drizzle-kit-only barrel. drizzle-kit's loader does not resolve `.js` paths
 * to sibling `.ts` files, so we can't point it at the main schema/index.ts
 * (which uses `.js` extensions for NodeNext compatibility). This file mirrors
 * the same exports without extensions; drizzle.config.ts points here.
 */
export * from './tenants';
export * from './users';
export * from './sessions';
export * from './audit-log';
export * from './email-verification-tokens';
export * from './password-reset-tokens';
