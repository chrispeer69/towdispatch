import type { JSX } from 'react';
import { ComingSoonCard } from '../coming-soon';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('account-rates');

export default function AccountRateCardsPage(): JSX.Element {
  return <ComingSoonCard title={TAB.label} description={TAB.description} />;
}
