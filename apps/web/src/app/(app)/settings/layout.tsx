/**
 * /settings layout — left rail with the 8 sub-tabs, content on the right.
 *
 * Sits inside the authenticated app shell (apps/web/src/app/(app)/layout.tsx)
 * which already provides the top sidebar, topbar, and content padding. This
 * layout adds a second rail specific to settings; vertical rather than the
 * horizontal strip used by /billing and /accounting because settings has
 * eight tabs (would wrap horizontally) and reads as an index, not a
 * workflow.
 */
import type { JSX, ReactNode } from 'react';
import { SettingsSidebar } from './settings-sidebar';

export const metadata = { title: 'Settings — US Tow DISPATCH' };

export default function SettingsLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
