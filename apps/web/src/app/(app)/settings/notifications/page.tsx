import type { JSX } from 'react';
import { ComingSoonCard } from '../coming-soon';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('notifications');

export default function NotificationsPage(): JSX.Element {
  return <ComingSoonCard title={TAB.label} description={TAB.description} />;
}
