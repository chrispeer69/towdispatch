/**
 * IANA timezone list with the US zones grouped at the top for the
 * Company Profile picker. The "popular" array shows first; "all" is the
 * complete searchable list that follows it.
 *
 * Generated from Intl.supportedValuesOf('timeZone') would be ideal at
 * runtime, but Next.js server bundles don't always carry the full
 * Intl tz-data on every deploy target, so we ship a static list. This
 * is good enough for an operator picker — the search filter narrows it
 * quickly.
 */

export const US_TIMEZONES = [
  'America/New_York',
  'America/Detroit',
  'America/Indiana/Indianapolis',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

export const OTHER_TIMEZONES = [
  'UTC',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
] as const;

export const ALL_TIMEZONES = [...US_TIMEZONES, ...OTHER_TIMEZONES] as const;
