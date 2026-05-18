import type { DriverDailyBriefingDto } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { decideBriefingBanner, todayKey } from '../briefing-helpers';

const baseBriefing: DriverDailyBriefingDto = {
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-00000000aaaa',
  title: 'Heat advisory',
  message: 'Hydrate every hour.',
  videoUrl: 'https://example.test/video.mp4',
  videoMinDurationSeconds: 30,
  isActive: true,
  publishedAt: '2026-05-18T08:00:00.000Z',
  expiresAt: null,
  createdAt: '2026-05-18T07:50:00.000Z',
  updatedAt: '2026-05-18T07:50:00.000Z',
  deletedAt: null,
};

describe('decideBriefingBanner', () => {
  it('hides when there is no briefing at all', () => {
    expect(
      decideBriefingBanner(
        { needs: false, briefing: null },
        { briefingId: null, acknowledgedDate: null },
      ),
    ).toEqual({ kind: 'hidden' });
  });

  it('shows the banner when the server says acknowledgment is needed', () => {
    const decision = decideBriefingBanner(
      { needs: true, briefing: baseBriefing },
      { briefingId: null, acknowledgedDate: null },
    );
    expect(decision.kind).toBe('banner');
    if (decision.kind === 'banner') expect(decision.briefing.id).toBe(baseBriefing.id);
  });

  it('shows the acknowledged pill when the server says no ack is needed', () => {
    const today = todayKey();
    const decision = decideBriefingBanner(
      { needs: false, briefing: baseBriefing },
      { briefingId: baseBriefing.id, acknowledgedDate: today },
    );
    expect(decision.kind).toBe('acknowledged-pill');
  });

  it('still shows the pill (not nothing) when local state is missing but server is caught up', () => {
    const decision = decideBriefingBanner(
      { needs: false, briefing: baseBriefing },
      { briefingId: null, acknowledgedDate: null },
    );
    expect(decision.kind).toBe('acknowledged-pill');
  });

  it('re-shows the banner if the server flips back to needs=true (new admin video posted)', () => {
    // Driver previously acknowledged briefing-1 locally; admin published
    // a new briefing-2 (different id) — server returns needs=true. The
    // helper trusts the server.
    const newBriefing = { ...baseBriefing, id: '00000000-0000-0000-0000-000000000002' };
    const decision = decideBriefingBanner(
      { needs: true, briefing: newBriefing },
      { briefingId: baseBriefing.id, acknowledgedDate: todayKey() },
    );
    expect(decision.kind).toBe('banner');
  });
});
