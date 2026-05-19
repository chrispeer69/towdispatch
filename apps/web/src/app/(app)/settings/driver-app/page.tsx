/**
 * /settings/driver-app — operator admin for the Driver App's daily
 * briefing.
 *
 * Backend already supports:
 *   GET    /driver-briefings/active                  → current active briefing or 404
 *   POST   /driver-briefings                         → create + (optionally) activate
 *   PATCH  /driver-briefings/:id                     → edit / activate / deactivate
 *
 * This page lets OWNER / ADMIN write the title + message, paste a video
 * URL (S3 / YouTube / wherever), set the minimum-watch threshold, and
 * mark it active. When isActive flips on, the API automatically
 * deactivates whatever was active before (partial unique index enforces
 * at most one active per tenant).
 */

import { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { DriverAppClient } from './driver-app-client';

const TAB = findSettingsTab('driver-app');

export default function DriverAppSettingsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-condensed text-2xl font-extrabold uppercase tracking-tight">
          {TAB.label}
        </h2>
        <p className="mt-1 text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>
      <DriverAppClient />
    </div>
  );
}
