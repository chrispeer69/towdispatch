/**
 * Shared presentation helpers for the public bidder marketplace (Session 33).
 *
 * Tenant branding: Session 32 (white-label / tenant_branding) is not merged
 * on this branch, so the marketplace renders with US Tow Dispatch fallback
 * defaults. When S32 lands, read tenant.settings.branding here. Documented
 * in SESSION_33_DECISIONS.md.
 */
export const MARKETPLACE_BRAND = {
  name: 'Vehicle Auctions',
  accent: '#F05A1A',
};

export function formatCents(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function listingTitle(l: {
  vehicleYear: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
}): string {
  const parts = [l.vehicleYear, l.make, l.model].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return l.vin ?? 'Vehicle';
}
