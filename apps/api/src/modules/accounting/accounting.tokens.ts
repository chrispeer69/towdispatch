/**
 * DI tokens for the accounting module.
 *
 * ACCOUNTING_PROVIDER is the QBO live provider when QBO_CLIENT_ID is set,
 * otherwise the in-memory stub. Tests override this with `.overrideProvider`.
 */
export const ACCOUNTING_PROVIDER = Symbol('ACCOUNTING_PROVIDER');
