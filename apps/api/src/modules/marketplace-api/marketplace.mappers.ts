/**
 * Row → DTO mappers for the marketplace tables. Centralized so every service
 * serializes the same shape (and never leaks a hash or client secret). pg
 * returns jsonb columns as parsed JS values and timestamptz as Date.
 */
import type {
  DeveloperAccountDto,
  InstalledAppDto,
  MarketplaceAppDto,
  MarketplaceAppPublicDto,
  MarketplaceEventDto,
} from '@ustowdispatch/shared';

const iso = (d: Date | string): string =>
  d instanceof Date ? d.toISOString() : new Date(d).toISOString();
const isoNull = (d: Date | string | null): string | null => (d == null ? null : iso(d));
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

export interface DeveloperRow {
  id: string;
  owner_user_email: string;
  company_name: string;
  verified: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export const toDeveloperDto = (r: DeveloperRow): DeveloperAccountDto => ({
  id: r.id,
  ownerUserEmail: r.owner_user_email,
  companyName: r.company_name,
  verified: r.verified,
  status: r.status as DeveloperAccountDto['status'],
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export interface AppRow {
  id: string;
  developer_id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  logo_url: string | null;
  scopes: unknown;
  oauth_redirect_urls: unknown;
  webhook_url: string | null;
  status: string;
  review_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export const toAppDto = (r: AppRow): MarketplaceAppDto => ({
  id: r.id,
  developerId: r.developer_id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  category: r.category as MarketplaceAppDto['category'],
  logoUrl: r.logo_url,
  scopes: arr(r.scopes) as MarketplaceAppDto['scopes'],
  oauthRedirectUrls: arr(r.oauth_redirect_urls),
  webhookUrl: r.webhook_url,
  status: r.status as MarketplaceAppDto['status'],
  reviewNotes: r.review_notes,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export interface AppPublicRow {
  slug: string;
  name: string;
  description: string;
  category: string;
  logo_url: string | null;
  scopes: unknown;
  developer_name: string;
  created_at: Date;
}

export const toAppPublicDto = (r: AppPublicRow): MarketplaceAppPublicDto => ({
  slug: r.slug,
  name: r.name,
  description: r.description,
  category: r.category as MarketplaceAppPublicDto['category'],
  logoUrl: r.logo_url,
  scopes: arr(r.scopes) as MarketplaceAppPublicDto['scopes'],
  developerName: r.developer_name,
  createdAt: iso(r.created_at),
});

export interface InstalledAppRow {
  id: string;
  app_id: string;
  app_slug: string;
  app_name: string;
  status: string;
  scopes_granted: unknown;
  installed_by_user_id: string | null;
  installed_at: Date;
  uninstalled_at: Date | null;
}

export const toInstalledAppDto = (r: InstalledAppRow): InstalledAppDto => ({
  id: r.id,
  appId: r.app_id,
  appSlug: r.app_slug,
  appName: r.app_name,
  status: r.status as InstalledAppDto['status'],
  scopesGranted: arr(r.scopes_granted) as InstalledAppDto['scopesGranted'],
  installedByUserId: r.installed_by_user_id,
  installedAt: iso(r.installed_at),
  uninstalledAt: isoNull(r.uninstalled_at),
});

export interface EventRow {
  id: string;
  app_id: string;
  tenant_id: string;
  install_id: string | null;
  event_type: string;
  occurred_at: Date;
  payload: unknown;
}

export const toEventDto = (r: EventRow): MarketplaceEventDto => ({
  id: r.id,
  appId: r.app_id,
  tenantId: r.tenant_id,
  installId: r.install_id,
  eventType: r.event_type as MarketplaceEventDto['eventType'],
  occurredAt: iso(r.occurred_at),
  payload:
    typeof r.payload === 'object' && r.payload !== null
      ? (r.payload as Record<string, unknown>)
      : {},
});
