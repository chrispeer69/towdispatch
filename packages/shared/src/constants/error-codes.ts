/**
 * Stable, public-facing error codes. Surface these in problem+json `type`
 * URIs so clients can branch on them without parsing strings. Never rename;
 * only add.
 */
export const ERROR_CODES = {
  // 4xx
  BAD_REQUEST: 'bad_request',
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  INVALID_CREDENTIALS: 'invalid_credentials',
  ACCOUNT_LOCKED: 'account_locked',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  MFA_REQUIRED: 'mfa_required',
  MFA_INVALID_CODE: 'mfa_invalid_code',
  TOKEN_EXPIRED: 'token_expired',
  TOKEN_INVALID: 'token_invalid',
  TOKEN_REUSED: 'token_reused',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  IDEMPOTENCY_KEY_REUSED: 'idempotency_key_reused',
  TENANT_INACTIVE: 'tenant_inactive',
  TENANT_CONTEXT_MISSING: 'tenant_context_missing',
  TENANT_SELECTION_REQUIRED: 'tenant_selection_required',

  // 5xx
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  EXTERNAL_DEPENDENCY_ERROR: 'external_dependency_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
