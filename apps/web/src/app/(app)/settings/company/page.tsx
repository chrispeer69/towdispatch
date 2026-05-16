import type { JSX } from 'react';
import { ComingSoonCard } from '../coming-soon';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('company');

export default function CompanyProfilePage(): JSX.Element {
  return <ComingSoonCard title={TAB.label} description={TAB.description} />;
}
