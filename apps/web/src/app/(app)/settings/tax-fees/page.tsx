import type { JSX } from 'react';
import { ComingSoonCard } from '../coming-soon';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('tax-fees');

export default function TaxFeesPage(): JSX.Element {
  return <ComingSoonCard title={TAB.label} description={TAB.description} />;
}
