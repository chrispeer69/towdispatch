/**
 * Daily Briefing UI helpers.
 *
 * The /driver-briefings/needs-acknowledgment endpoint returns a
 * { needs, briefing } object; this module owns the pure decision of
 * whether the workspace should render the unmissable banner.
 *
 * Edge cases handled:
 *   - No active briefing → no banner (admin hasn't published anything)
 *   - Active briefing but already acknowledged today → no banner
 *   - Active briefing not yet acknowledged → banner
 *   - Briefing updated today (videoUrl changed since previous ack) →
 *     banner re-appears even if the driver acknowledged the prior
 *     version. The server is authoritative; the local pill (collapsed
 *     ack) checks the briefing.id to detect change.
 */
import type { DriverDailyBriefingDto } from '@ustowdispatch/shared';

export interface BriefingNeedsResponse {
  needs: boolean;
  briefing: DriverDailyBriefingDto | null;
}

export interface LocalAckState {
  /** Last briefing id the driver acknowledged on THIS device. */
  briefingId: string | null;
  /** ISO date string (YYYY-MM-DD) of the local-side ack. */
  acknowledgedDate: string | null;
}

export type BriefingBannerDecision =
  | { kind: 'hidden' }
  | { kind: 'banner'; briefing: DriverDailyBriefingDto }
  | { kind: 'acknowledged-pill'; briefing: DriverDailyBriefingDto };

export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Decide which form of briefing surface to render on the workspace home.
 *
 * - If the server says `needs=true`, the banner is shown regardless of
 *   local state. The server is the source of truth for acknowledgments.
 * - If the server says `needs=false` AND we have a briefing for today,
 *   show the compact pill so the driver has visual confirmation.
 * - If there's no briefing at all (vacation day, holiday), render
 *   nothing.
 * - The 'new admin video posted' edge case is the server flipping `needs`
 *   back to true after the briefing.id changes — the helper just trusts
 *   `needs`. Local state is only used to render the pill when the server
 *   says we're caught up.
 */
export function decideBriefingBanner(
  resp: BriefingNeedsResponse | null,
  local: LocalAckState,
  now = new Date(),
): BriefingBannerDecision {
  if (!resp || !resp.briefing) return { kind: 'hidden' };
  if (resp.needs) return { kind: 'banner', briefing: resp.briefing };
  const today = todayKey(now);
  if (local.briefingId === resp.briefing.id && local.acknowledgedDate === today) {
    return { kind: 'acknowledged-pill', briefing: resp.briefing };
  }
  // Server says we're caught up but local state hasn't recorded the ack
  // (e.g., user signed in on a new device after acknowledging on another).
  // Render the pill regardless — the source of truth is the server.
  return { kind: 'acknowledged-pill', briefing: resp.briefing };
}
