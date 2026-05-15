/**
 * Edge-runtime-safe cookie constants. Lives separately from cookies.ts so
 * middleware (which runs in the Edge runtime and cannot import `next/headers`)
 * can share the same names and TTLs as the server-action helpers.
 */
export const ACCESS_COOKIE = 'tc_at';
export const REFRESH_COOKIE = 'tc_rt';
export const MFA_SETUP_COOKIE = 'tc_mfa_setup';
export const MFA_CHALLENGE_COOKIE = 'tc_mfa_challenge';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MFA_SETUP_TTL_SECONDS = 15 * 60;
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
