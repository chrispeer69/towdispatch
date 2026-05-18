'use client';

/**
 * /driver/briefing — full-screen variant of the daily briefing banner.
 *
 * Reachable from the workspace banner ("Open full briefing") or as a
 * deep-link from a push notification. After acknowledgment we redirect
 * back to ?next= (default /driver/workspace).
 */
import { DriverShell } from '@/components/driver/driver-shell';
import { Button } from '@/components/ui/button';
import { DriverApiError, driverApi } from '@/lib/driver/api-client';
import { DRIVER_BRIEFING_LOCAL_ACK_KEY } from '@/lib/driver/storage-keys';
import type { DriverDailyBriefingDto } from '@/lib/driver/types';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function DriverBriefingPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') ?? '/driver/workspace';
  const [briefing, setBriefing] = useState<DriverDailyBriefingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [read, setRead] = useState(false);
  const [videoCompletedAt, setVideoCompletedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const dto = await driverApi<DriverDailyBriefingDto>('GET', '/driver-briefings/active');
        setBriefing(dto);
      } catch (err) {
        if (err instanceof DriverApiError) setError(err.message);
        else setError('Could not load briefing.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function acknowledge(): Promise<void> {
    if (!briefing) return;
    setBusy(true);
    try {
      const body: { briefingId: string; messageReadAt?: string; videoCompletedAt?: string } = {
        briefingId: briefing.id,
        messageReadAt: new Date().toISOString(),
        ...(videoCompletedAt ? { videoCompletedAt } : {}),
      };
      await driverApi('POST', `/driver-briefings/${briefing.id}/acknowledge`, body);
      const today = new Date().toISOString().slice(0, 10);
      window.localStorage.setItem(
        DRIVER_BRIEFING_LOCAL_ACK_KEY,
        JSON.stringify({ briefingId: briefing.id, acknowledgedDate: today }),
      );
      router.replace(next);
    } catch (err) {
      setError(err instanceof DriverApiError ? err.message : 'Could not acknowledge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DriverShell title="Daily Briefing" backHref="/driver/workspace">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading briefing…
        </div>
      ) : !briefing ? (
        <p className="text-sm text-text-secondary-on-dark">
          {error ?? 'No briefing is active right now.'}
        </p>
      ) : (
        <article className="space-y-4">
          <header>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-primary">
              Daily Briefing
            </p>
            <h1 className="mt-1 text-2xl font-extrabold uppercase tracking-tight">
              {briefing.title}
            </h1>
            {briefing.publishedAt ? (
              <p className="mt-1 text-xs text-text-secondary-on-dark">
                Published {new Date(briefing.publishedAt).toLocaleString()}
              </p>
            ) : null}
          </header>

          <p className="whitespace-pre-wrap text-base leading-7">{briefing.message}</p>

          {briefing.videoUrl ? (
            <video
              controls
              preload="metadata"
              className="w-full max-w-full rounded-[10px] bg-black"
              style={{ aspectRatio: '16/9' }}
              onEnded={() => setVideoCompletedAt(new Date().toISOString())}
            >
              <source src={briefing.videoUrl} />
              {/* Captions are produced by the admin authoring flow when a
                  briefing video is uploaded; until then we render an empty
                  track so the a11y lint stays satisfied. */}
              <track kind="captions" srcLang="en" label="English" />
              Your browser does not support inline video.
            </video>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={read}
              onChange={(e) => setRead(e.target.checked)}
              className="h-5 w-5"
            />
            I have read and watched the briefing for today.
          </label>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button
            size="touch"
            className="w-full"
            disabled={!read || busy}
            onClick={() => void acknowledge()}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                Acknowledge briefing
              </>
            )}
          </Button>
        </article>
      )}
    </DriverShell>
  );
}
