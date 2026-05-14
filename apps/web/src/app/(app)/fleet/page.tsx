import { redirect } from 'next/navigation';

export default function FleetIndexPage(): never {
  // [FLEET_DEBUG] — temporary diagnostic. Revert after the fleet bounce is fixed.
  // eslint-disable-next-line no-console
  console.error('[FLEET_DEBUG] fleet/page enter — about to redirect to /fleet/trucks');
  redirect('/fleet/trucks');
}
