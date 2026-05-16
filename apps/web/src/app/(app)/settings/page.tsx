/**
 * /settings root — redirects to the first tab (Company Profile). The
 * sidebar Settings link points at /settings (not /settings/company) so
 * a tenant who lands here from a bookmark also gets the default tab.
 */
import { redirect } from 'next/navigation';
import { DEFAULT_SETTINGS_TAB, settingsTabHref } from './tabs';

export default function SettingsIndex(): never {
  redirect(settingsTabHref(DEFAULT_SETTINGS_TAB));
}
