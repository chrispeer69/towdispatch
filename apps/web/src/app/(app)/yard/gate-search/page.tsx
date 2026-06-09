/**
 * /yard/gate-search — the gate-booth lookup across impound by plate / VIN /
 * payer name, with current stall, balance owed, and a Release shortcut.
 */
import type { JSX } from 'react';
import { GateSearchClient } from './gate-search-client';

export const metadata = { title: 'Gate Search — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

export default function GateSearchPage(): JSX.Element {
  return <GateSearchClient />;
}
