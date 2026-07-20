import { tryFetch } from '@/lib/api/client';
import { fetchTenantCurrent } from '@/lib/api/resources';
import { getSessionToken } from '@/lib/auth/cookies';
import { getOptionalUser } from '@/lib/auth/session';
import { type UsState, buildPrioritizedStateList } from '@ustowdispatch/shared';
import { IntakeClient } from './intake-client';

export const metadata = { title: 'Call Intake â€” US Tow Dispatch' };

/**
 * /intake â€” the call-intake screen.
 *
 * Server component thinly wraps the client form. Auth gating lives in the
 * (app)/ layout â€” we read the session here only to surface the tenant name,
 * using the non-throwing getOptionalUser() so a transient /auth/me flake
 * cannot redirect this page out from under a layout that already streamed an
 * authenticated shell. See lib/auth/session.ts for the chokepoint.
 *
 * Also fetches tenant.settings.physical_address up front so the client can
 * compute "X mi from office" hints next to the pickup field without an extra
 * client-side round trip. Read-only — the form never writes back here.
 */
interface CompanyAddressLike {
  street_1?: unknown;
  street_2?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
}

function formatOfficeAddress(addr: CompanyAddressLike | null | undefined): string | null {
  if (!addr || typeof addr !== 'object') return null;
  const parts = [
    typeof addr.street_1 === 'string' ? addr.street_1 : '',
    typeof addr.city === 'string' ? addr.city : '',
    typeof addr.state === 'string' ? addr.state : '',
    typeof addr.zip === 'string' ? addr.zip : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(', ');
}

export default async function IntakePage(): Promise<JSX.Element> {
  const session = await getOptionalUser();
  const tenantName = session?.tenant.name ?? '';

  // tryFetch swallows 4xx so a missing physical_address (e.g. the company
  // profile hasn't been filled out yet) just leaves us with no office origin
  // — the form still works, distance hints just won't render.
  const token = await getSessionToken();
  const tenantResult = await tryFetch(() => fetchTenantCurrent(token));
  const settings = tenantResult.data?.settings as
    | {
        physical_address?: CompanyAddressLike;
        secondary_states?: unknown;
      }
    | undefined;
  const officeAddress = formatOfficeAddress(settings?.physical_address);

  // Build the prioritized plate-state list once on the server so it ships
  // pre-sorted to the client. Falls back to a plain alphabetical list when
  // the tenant hasn't set a home state yet.
  const homeState =
    typeof settings?.physical_address?.state === 'string'
      ? (settings.physical_address.state as UsState)
      : null;
  const secondaryStates = Array.isArray(settings?.secondary_states)
    ? (settings?.secondary_states.filter((s): s is UsState => typeof s === 'string') as UsState[])
    : [];
  const stateOptions = buildPrioritizedStateList(homeState, secondaryStates);

  const rawToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? null;
  const mapboxToken = rawToken && !rawToken.startsWith('pk.placeholder') ? rawToken : null;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            Call Intake
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Phone-first capture{tenantName ? ` Â- ${tenantName}` : ''}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          Tab to advance Â- Cmd/Ctrl+Enter to dispatch
        </span>
      </header>
      <IntakeClient
        officeAddress={officeAddress}
        mapboxToken={mapboxToken}
        stateOptions={stateOptions}
      />
    </div>
  );
}
