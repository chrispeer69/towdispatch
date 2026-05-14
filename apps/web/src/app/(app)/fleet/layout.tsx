import { getRequestId } from '@/lib/debug/redirect-trace';
import { FleetTabs } from './fleet-tabs';

export const metadata = { title: 'Fleet — TowCommand' };

export default function FleetLayout({ children }: { children: React.ReactNode }): JSX.Element {
  // [FLEET_DEBUG_V2] — log fleet sub-layout render. If we see this in Railway
  // logs but not the page-level "fleet/drivers/page enter", something is
  // interrupting render between them.
  // eslint-disable-next-line no-console
  console.error(`[FLEET_DEBUG_V2 rid=${getRequestId()}] fleet/layout render`);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Fleet
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Trucks, drivers, expirations, maintenance, DVIR.
        </p>
      </header>
      <FleetTabs />
      <div>{children}</div>
    </div>
  );
}
