import type { JSX } from 'react';
import { ComingSoonCard } from '../coming-soon';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('invoice-defaults');

export default function InvoiceDefaultsPage(): JSX.Element {
  return <ComingSoonCard title={TAB.label} description={TAB.description} />;
}
