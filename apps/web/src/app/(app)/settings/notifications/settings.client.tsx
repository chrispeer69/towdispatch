'use client';

/**
 * Preferences matrix UI. Shows each (event_category, channel) cell as a
 * checkbox; PATCH sends the touched cells back. Quiet hours is a separate
 * section with timezone + start/end picker + override list.
 */
import { clientUpdatePreferences } from '@/lib/api/notifications';
import type {
  NotificationChannel,
  UpdateUserPreferencesPayload,
  UserPreferencesDto,
} from '@ustowdispatch/shared';
import { useState, useTransition } from 'react';

const CATEGORIES = [
  'dispatch',
  'motor_club',
  'customer',
  'billing',
  'compliance',
  'system',
  'operational',
  'security',
] as const;
const CHANNELS: ReadonlyArray<{ key: NotificationChannel; label: string }> = [
  { key: 'push', label: 'Push' },
  { key: 'sms', label: 'SMS' },
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
];

export function NotificationsSettings({
  initial,
}: {
  initial: UserPreferencesDto;
}): JSX.Element {
  const [matrix, setMatrix] = useState(initial.preferences);
  const [qh, setQh] = useState(initial.quietHours);
  const [saving, startSaving] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function isEnabled(cat: string, ch: NotificationChannel): boolean {
    return matrix.find((m) => m.eventCategory === cat && m.channel === ch)?.enabled ?? false;
  }

  function setCell(cat: string, ch: NotificationChannel, enabled: boolean): void {
    setMatrix((rows) => {
      const idx = rows.findIndex((r) => r.eventCategory === cat && r.channel === ch);
      const next = idx >= 0 ? [...rows] : [...rows, { eventCategory: cat, channel: ch, enabled }];
      if (idx >= 0) next[idx] = { ...next[idx]!, enabled };
      return next;
    });
  }

  function onSave(): void {
    setError(null);
    startSaving(async () => {
      try {
        const body: UpdateUserPreferencesPayload = {
          preferences: matrix.filter((c) => c.channel !== 'webhook'),
          quietHours: qh,
        };
        const result = await clientUpdatePreferences(body);
        setMatrix(result.preferences);
        setQh(result.quietHours);
        setSavedAt(new Date().toLocaleTimeString());
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-steel-border bg-steel-mid/30 p-4">
        <h2 className="mb-3 font-condensed text-base font-extrabold uppercase tracking-wide">
          Channels by event category
        </h2>
        <div className="overflow-hidden rounded-md border border-steel-border">
          <table className="w-full text-sm" data-testid="prefs-matrix">
            <thead className="bg-steel-mid/60 text-left">
              <tr>
                <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">
                  Event category
                </th>
                {CHANNELS.map((c) => (
                  <th
                    key={c.key}
                    className="px-3 py-2 text-center text-xs uppercase tracking-wider text-text-muted"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-border">
              {CATEGORIES.map((cat) => (
                <tr key={cat}>
                  <td className="px-3 py-2 capitalize">{cat.replace('_', ' ')}</td>
                  {CHANNELS.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${cat} via ${c.label}`}
                        checked={isEnabled(cat, c.key)}
                        onChange={(e) => setCell(cat, c.key, e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-orange"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-steel-border bg-steel-mid/30 p-4">
        <h2 className="mb-3 font-condensed text-base font-extrabold uppercase tracking-wide">
          Quiet hours
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={qh.enabled}
              onChange={(e) => setQh({ ...qh, enabled: e.target.checked })}
              className="h-4 w-4 cursor-pointer accent-orange"
            />
            Enable quiet hours
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
            Start
            <input
              type="time"
              value={qh.startLocal}
              onChange={(e) => setQh({ ...qh, startLocal: e.target.value })}
              className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
            />
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
            End
            <input
              type="time"
              value={qh.endLocal}
              onChange={(e) => setQh({ ...qh, endLocal: e.target.value })}
              className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
            />
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
            Timezone (IANA)
            <input
              type="text"
              value={qh.timezone}
              onChange={(e) => setQh({ ...qh, timezone: e.target.value })}
              placeholder="America/New_York"
              className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Emergency notifications (motor-club jobs, security alerts) always bypass quiet hours.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-orange px-4 py-2 text-sm font-bold uppercase tracking-wider text-white hover:bg-orange-light disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        {savedAt && <span className="text-xs text-text-secondary">Saved at {savedAt}</span>}
        {error && <span className="text-xs text-red-400">Error: {error}</span>}
      </div>
    </div>
  );
}
