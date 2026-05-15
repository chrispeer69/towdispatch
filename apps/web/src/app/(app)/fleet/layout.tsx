import { FleetTabs } from './fleet-tabs';

export const metadata = { title: 'Fleet â€” US Tow DISPATCH' };

export default function FleetLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          Fleet
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Trucks, drivers, expirations, maintenance, DVIR.
        </p>
      </header>
      <FleetTabs />
      <div>{children}</div>
    </div>
  );
}
