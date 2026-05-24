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
  // Public REST API (Session 29). Distinct codes so consumers branch on the
  // failure mode without parsing strings.
  API_KEY_INVALID: 'api_key_invalid',
  API_KEY_EXPIRED: 'api_key_expired',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  TENANT_INACTIVE: 'tenant_inactive',
  TENANT_CONTEXT_MISSING: 'tenant_context_missing',
  TENANT_SELECTION_REQUIRED: 'tenant_selection_required',

  INVALID_STATE_TRANSITION: 'invalid_state_transition',
  DRIVER_OFF_SHIFT: 'driver_off_shift',
  DRIVER_ALREADY_ON_SHIFT: 'driver_already_on_shift',
  TRUCK_NOT_IN_SERVICE: 'truck_not_in_service',
  TRUCK_ALREADY_ASSIGNED: 'truck_already_assigned',
  /**
   * Driver attempted PIN login but no PIN has been enrolled for them
   * yet. Surface as a distinct 401 so the in-truck app can route the
   * driver to the self-serve PIN-pick screen instead of an opaque
   * "Invalid PIN" message. Not an information leak: the
   * /driver-auth/lookup-by-code endpoint already returns the full driver
   * roster, so an unauthenticated probe with the company code already
   * has the driver list — PIN-set status adds nothing new.
   */
  PIN_NOT_SET: 'pin_not_set',

  // Auction & Remarketing Marketplace (Session 33).
  AUCTION_BID_TOO_LOW: 'auction_bid_too_low',
  AUCTION_NOT_LIVE: 'auction_not_live',
  AUCTION_ENDED: 'auction_ended',
  BIDDER_EMAIL_NOT_VERIFIED: 'bidder_email_not_verified',
  BIDDER_BLOCKED: 'bidder_blocked',
  /**
   * Marketplace API / OAuth2 (Session 46). OAuth-layer codes follow RFC 6749
   * §5.2 names where one exists so standards-aware clients can branch on them.
   */
  OAUTH_INVALID_CLIENT: 'oauth_invalid_client',
  OAUTH_INVALID_GRANT: 'oauth_invalid_grant',
  OAUTH_INVALID_SCOPE: 'oauth_invalid_scope',
  OAUTH_INVALID_REQUEST: 'oauth_invalid_request',
  OAUTH_UNSUPPORTED_GRANT_TYPE: 'oauth_unsupported_grant_type',
  MARKETPLACE_APP_NOT_LISTED: 'marketplace_app_not_listed',
  MARKETPLACE_INVALID_APP_STATE: 'marketplace_invalid_app_state',
  MARKETPLACE_SCOPE_NOT_GRANTED: 'marketplace_scope_not_granted',
  MARKETPLACE_NOT_INSTALLED: 'marketplace_not_installed',

  // Enterprise SSO (Session 38)
  SSO_DISABLED: 'sso_disabled',
  SSO_TENANT_NOT_ALLOWED: 'sso_tenant_not_allowed',
  SSO_CONNECTION_NOT_FOUND: 'sso_connection_not_found',
  SSO_INVALID_ASSERTION: 'sso_invalid_assertion',
  SSO_INVALID_STATE: 'sso_invalid_state',
  SSO_PROVIDER_ERROR: 'sso_provider_error',
  SSO_USER_NOT_PROVISIONED: 'sso_user_not_provisioned',
  SCIM_TOKEN_INVALID: 'scim_token_invalid',
  SCIM_FILTER_UNSUPPORTED: 'scim_filter_unsupported',

  // Repossession Workflow (Session 49)
  REPO_CASE_INVALID_STATE: 'repo_case_invalid_state',
  REPO_CASE_DUPLICATE_NUMBER: 'repo_case_duplicate_number',
  REPO_MODULE_DISABLED: 'repo_module_disabled',
  LIENHOLDER_IN_USE: 'lienholder_in_use',

  // 5xx
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  EXTERNAL_DEPENDENCY_ERROR: 'external_dependency_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
