/**
 * Public Marketplace API (Session 46) — tenant-side install + event contracts.
 *
 * An install binds a tenant to an app with a granted scope set and the hashed
 * OAuth tokens. Installs are TENANT-SCOPED (FORCE RLS): a tenant operator only
 * ever sees their own. App-lifecycle events (install/uninstall/scope_change/
 * reauth/error) are recorded per-install and double as the webhook payload log.
 */
import { z } from 'zod';
import { MARKETPLACE_SCOPES } from './scopes';

const scopeEnum = z.enum(MARKETPLACE_SCOPES);

export const installStatusValues = ['active', 'uninstalled'] as const;
export type InstallStatus = (typeof installStatusValues)[number];

export const marketplaceEventTypeValues = [
  'install',
  'uninstall',
  'reauth',
  'scope_change',
  'error',
] as const;
export type MarketplaceEventType = (typeof marketplaceEventTypeValues)[number];

/** Tenant operator's view of one installed app (joins the app's display fields). */
export const installedAppSchema = z.object({
  id: z.string().uuid(),
  appId: z.string().uuid(),
  appSlug: z.string(),
  appName: z.string(),
  status: z.enum(installStatusValues),
  scopesGranted: z.array(scopeEnum),
  installedByUserId: z.string().uuid().nullable(),
  installedAt: z.string().datetime(),
  uninstalledAt: z.string().datetime().nullable(),
});
export type InstalledAppDto = z.infer<typeof installedAppSchema>;

/**
 * POST /apps/:slug/install — the operator picks which of the app's declared
 * scopes to grant (must be a subset). Returns the params the client needs to
 * drive the OAuth /authorize step (PKCE challenge is generated client-side).
 */
export const beginInstallSchema = z.object({
  scopes: z.array(scopeEnum).min(1),
  redirectUri: z.string().url().startsWith('https://'),
});
export type BeginInstallPayload = z.infer<typeof beginInstallSchema>;

export const beginInstallResultSchema = z.object({
  clientId: z.string().uuid(),
  appSlug: z.string(),
  /** Scopes the operator may grant (intersection of app-declared and requested). */
  approvedScopes: z.array(scopeEnum),
  authorizeEndpoint: z.literal('/oauth/authorize'),
});
export type BeginInstallResult = z.infer<typeof beginInstallResultSchema>;

export const marketplaceEventSchema = z.object({
  id: z.string().uuid(),
  appId: z.string().uuid(),
  tenantId: z.string().uuid(),
  installId: z.string().uuid().nullable(),
  eventType: z.enum(marketplaceEventTypeValues),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown()),
});
export type MarketplaceEventDto = z.infer<typeof marketplaceEventSchema>;
