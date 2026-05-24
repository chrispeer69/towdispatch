'use client';

/**
 * /driver/jobs/[jobId] — the on-the-road job surface.
 *
 * Top → bottom:
 *   1. Header: job number, status, motor club, ETA placeholder
 *   2. Customer card (tap-to-call, tap-to-Maps)
 *   3. Vehicle card (read-only YMM + plate)
 *   4. Status state machine controls
 *   5. Evidence tabs: Photos / Video / Signature
 *   6. Field payment (gated by shift active + status >= in_progress)
 *   7. Notes ledger
 *
 * Every mutating action attempts a live API call; if it fails offline
 * the action is queued via lib/driver/offline-queue.
 */
import { DriverShell } from '@/components/driver/driver-shell';
import { OfflineBanner } from '@/components/driver/offline-banner';
import { SignaturePad, type SignaturePadHandle } from '@/components/driver/signature-pad';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DriverApiError, driverApi } from '@/lib/driver/api-client';
import { uploadEvidence } from '@/lib/driver/evidence-upload';
import { currentPosition } from '@/lib/driver/gps';
import { enqueueAction } from '@/lib/driver/offline-queue';
import {
  STATUS_CTA,
  STATUS_LABEL,
  applyDriverTransition,
  nextAllowed,
} from '@/lib/driver/transitions';
import type { DriverShiftDto, JobDto, JobEvidenceKind, JobStatus } from '@/lib/driver/types';
import {
  Camera,
  CreditCard,
  Loader2,
  MapPin,
  Mic,
  Navigation,
  Phone,
  StickyNote,
  Trash2,
  Video,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface EvidenceEntry {
  id: string;
  s3Key: string;
  kind: JobEvidenceKind;
  uploadStatus: string;
  createdAt: string;
}

type EvidenceTab = 'photos' | 'video' | 'signature';

export default function DriverJobPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params?.jobId ?? '';

  const [job, setJob] = useState<JobDto | null>(null);
  const [shift, setShift] = useState<DriverShiftDto | null>(null);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<EvidenceTab>('photos');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [notes, setNotes] = useState<{ id: string; text: string; addedAt: string }[]>([]);
  const [newNote, setNewNote] = useState('');
  const [busyStatus, setBusyStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [j, s, ev] = await Promise.all([
        driverApi<JobDto>('GET', `/driver-jobs/${jobId}`),
        driverApi<DriverShiftDto | null>('GET', '/driver-shifts/me'),
        driverApi<EvidenceEntry[]>('GET', `/jobs/${jobId}/evidence`).catch(
          () => [] as EvidenceEntry[],
        ),
      ]);
      setJob(j);
      setShift(s);
      setEvidence(ev);
      setError(null);
    } catch (err) {
      if (err instanceof DriverApiError) setError(err.message);
      else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    void refresh();
  }, [jobId, refresh]);

  async function transition(to: JobStatus): Promise<void> {
    if (!job) return;
    setBusyStatus(to);
    const pos = await currentPosition();
    const result = await applyDriverTransition({
      jobId: job.id,
      to,
      ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
    });
    setBusyStatus(null);
    if (result.status === 'failed') {
      window.alert(`Could not move job to ${STATUS_LABEL[to]}: ${result.reason ?? 'unknown'}`);
      return;
    }
    if (result.status === 'queued') {
      // Optimistically reflect; the queue replays on reconnect.
      setJob({ ...job, status: to });
      return;
    }
    void refresh();
  }

  async function handlePhoto(kind: JobEvidenceKind, file: File): Promise<void> {
    if (!job) return;
    try {
      const pos = await currentPosition();
      await uploadEvidence({
        jobId: job.id,
        kind,
        file,
        ...(pos ? { capturedLat: pos.lat, capturedLng: pos.lng } : {}),
      });
      void refresh();
    } catch (err) {
      window.alert(`Upload failed: ${(err as Error).message}`);
    }
  }

  async function addNote(): Promise<void> {
    if (!newNote.trim() || !job) return;
    const text = newNote.trim();
    setNotes((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, addedAt: new Date().toISOString() },
    ]);
    setNewNote('');
    enqueueAction({
      actionKind: 'note_add',
      jobId: job.id,
      payload: { text, addedAt: new Date().toISOString() },
    });
  }

  if (loading) {
    return (
      <DriverShell title="Job" backHref="/driver/workspace">
        <div className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading job…
        </div>
      </DriverShell>
    );
  }
  if (!job) {
    return (
      <DriverShell title="Job" backHref="/driver/workspace">
        <p className="text-sm text-danger">{error ?? 'Job not found.'}</p>
        <Button
          size="touch"
          className="mt-3 w-full"
          onClick={() => router.replace('/driver/workspace')}
        >
          Back to workspace
        </Button>
      </DriverShell>
    );
  }

  const next = nextAllowed(job.status);
  const canCapturePayment = Boolean(
    shift?.id && (job.status === 'in_progress' || job.status === 'completed'),
  );

  return (
    <DriverShell title={job.jobNumber} backHref="/driver/workspace">
      <OfflineBanner />

      {/* The job# / authorized-by metadata that used to live on its
         own header card is reference-only — the DriverShell title
         already shows the job number, so the redundant card is gone.
         The status pill now lives inside the Service headline. */}
      <ServiceHeadline job={job} />
      <CustomerCard job={job} />
      <VehicleCard job={job} />
      <Card className="mb-3">
        <CardContent className="p-3">
          <Button
            size="touch"
            variant="secondary"
            className="w-full"
            onClick={() => router.push(`/driver/jobs/${job.id}/ev`)}
          >
            ⚡ EV recovery procedures
          </Button>
        </CardContent>
      </Card>
      <RouteCard job={job} />
      <OfficeNotesCard job={job} />

      {/* Move job forward — single-row layout. The label sits left,
         the action pill (sized to match the Navigate button on the
         route card) sits right. When multiple transitions are
         available the additional pills wrap inline. */}
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <p className="text-sm font-semibold">Move job forward</p>
          {next.length === 0 ? (
            <p className="ml-auto text-xs text-text-secondary-on-dark">
              No further transitions from {STATUS_LABEL[job.status]}.
            </p>
          ) : (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {next.map((to) => (
                <button
                  key={to}
                  type="button"
                  disabled={busyStatus === to}
                  onClick={() => void transition(to)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-primary px-3 text-sm font-semibold text-brand-primary-foreground shadow-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                >
                  {busyStatus === to ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    (STATUS_CTA[to] ?? `Mark ${STATUS_LABEL[to]}`)
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-3">
        <CardContent className="space-y-3 p-5">
          <div className="flex border-b border-divider">
            {(['photos', 'video', 'signature'] as EvidenceTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`h-11 flex-1 text-sm font-semibold capitalize ${
                  tab === t
                    ? 'border-b-2 border-brand-primary text-brand-primary'
                    : 'text-text-secondary-on-dark'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'photos' ? (
            <PhotoTab evidence={evidence} onCapture={(file) => handlePhoto('photo_damage', file)} />
          ) : tab === 'video' ? (
            <VideoTab
              evidence={evidence}
              onCapture={(file) => handlePhoto('video_walkaround', file)}
            />
          ) : (
            <SignatureTab job={job} onSaved={() => void refresh()} />
          )}
        </CardContent>
      </Card>

      {/* Field payment — single-row layout. Label left, Capture-payment
         pill right at Navigate-button size. The blurb explaining when
         the button is gated lives in the disabled tooltip / aria-label
         instead of consuming a second row of card height. */}
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <p className="text-sm font-semibold">Field payment</p>
          <button
            type="button"
            disabled={!canCapturePayment}
            onClick={() => setPaymentOpen(true)}
            title={
              canCapturePayment
                ? 'Capture payment at the scene with the Stripe Terminal reader'
                : 'Available once the job is in progress and a shift is active'
            }
            aria-label="Capture payment"
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-primary px-3 text-sm font-semibold text-brand-primary-foreground shadow-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            <CreditCard className="h-4 w-4" />
            Capture payment
          </button>
        </CardContent>
      </Card>

      {/* Notes — header carries the action buttons inline so the card
         doesn't grow a third row just to hold a Post-note button.
         Empty state line is gone (an empty list is its own state). */}
      <Card className="mb-3">
        <CardContent className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <StickyNote className="h-4 w-4" /> Notes
            </p>
            <div className="ml-auto flex items-center gap-2">
              <VoiceDictateButton
                onResult={(text) => setNewNote((s) => (s ? `${s} ${text}` : text))}
              />
              <button
                type="button"
                disabled={!newNote.trim()}
                onClick={() => void addNote()}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-primary px-3 text-sm font-semibold text-brand-primary-foreground shadow-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                Post note
              </button>
            </div>
          </div>
          <Textarea
            placeholder="Add a note for dispatch — or tap the mic to dictate."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            maxLength={2000}
          />
          {notes.length > 0 ? (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-[10px] border border-divider p-3 text-sm">
                  <p className="text-xs text-text-secondary-on-dark">
                    {new Date(n.addedAt).toLocaleTimeString()}
                  </p>
                  <p>{n.text}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <PaymentDialog job={job} shift={shift} open={paymentOpen} onOpenChange={setPaymentOpen} />
    </DriverShell>
  );
}

/**
 * Service headline. The visual focal point of the job file: a glowing
 * blue service-type label flanked by the SERVICE caption (left) and
 * the live status pill (right). Replaces the standalone status card
 * from the previous design — status + service now share one row.
 */
function ServiceHeadline({ job }: { job: JobDto }): JSX.Element {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-blue-500/40 bg-blue-500/5 px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-primary-on-dark">
        Service
      </span>
      <span className="flex-1 text-center text-lg font-extrabold uppercase tracking-tight text-blue-400 [text-shadow:0_0_18px_rgba(59,130,246,0.55)]">
        {(job.serviceType ?? 'tow').replace(/_/g, ' ')}
      </span>
      <Badge tone={badgeToneForStatus(job.status)}>{STATUS_LABEL[job.status]}</Badge>
    </div>
  );
}

function CustomerCard({ job }: { job: JobDto }): JSX.Element {
  const customer = job.customer;
  const customerName = customer?.name ?? 'Customer pending';
  const phone = customer?.phone ?? null;
  // Strip everything but digits + leading + for the tel:/sms: hrefs.
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : null;
  const smsHref = phone ? `sms:${phone.replace(/[^+\d]/g, '')}` : null;
  return (
    <Card className="mb-3">
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold leading-tight">{customerName}</p>
          {phone ? (
            <p className="font-mono text-xs text-text-secondary-on-dark">{phone}</p>
          ) : (
            <p className="text-xs text-text-secondary-on-dark">No phone on file</p>
          )}
        </div>
        {telHref ? (
          <a
            href={telHref}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-primary px-3 text-sm font-semibold text-brand-primary-foreground"
            aria-label={`Call ${customerName}`}
          >
            <Phone className="h-4 w-4" />
            Call
          </a>
        ) : null}
        {smsHref ? (
          <a
            href={smsHref}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-divider px-3 text-sm font-semibold"
            aria-label={`Text ${customerName}`}
          >
            Text
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
/**
 * Vehicle card — compact. The YMM + color is tappable: tapping it
 * opens a Google Image search for the make/model so the driver can
 * visually confirm the vehicle in low light or a packed lot. The
 * drivetrain (4WD / 2WD / AWD / RWD / FWD) is rendered in bright
 * red because it materially changes the hookup decision and missing
 * it can damage the vehicle.
 */
function VehicleCard({ job }: { job: JobDto }): JSX.Element {
  const v = job.vehicle;
  if (!v) {
    return (
      <Card className="mb-3">
        <CardContent className="p-3">
          <p className="text-sm font-semibold text-text-secondary-on-dark">Vehicle pending</p>
        </CardContent>
      </Card>
    );
  }
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  const plate = v.plate ? `${v.plate}${v.plateState ? ` (${v.plateState})` : ''}` : null;
  // Build a Google Images query when we have at least a make and model.
  // Falls back to a plain text label if we don't (so we never render a
  // dead link).
  const imageQuery = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  const imageUrl = imageQuery
    ? `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageQuery)}`
    : null;
  return (
    <Card className="mb-3">
      <CardContent className="space-y-1 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <p className="text-base font-bold leading-tight">
            {imageUrl ? (
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline-offset-2 hover:underline"
                aria-label={`Open Google Images for ${imageQuery}`}
              >
                {ymm || 'Vehicle details pending'}
              </a>
            ) : (
              <>{ymm || 'Vehicle details pending'}</>
            )}
            {v.color ? (
              <span className="ml-1 text-sm font-semibold text-text-secondary-on-dark">
                · {v.color}
              </span>
            ) : null}
          </p>
          {v.drivetrain ? (
            <span className="rounded-[6px] bg-danger/15 px-2 py-0.5 font-mono text-[11px] font-extrabold uppercase tracking-wide text-danger">
              {v.drivetrain}
            </span>
          ) : null}
        </div>
        {plate || v.vin ? (
          <p className="font-mono text-[11px] uppercase tracking-wide text-text-secondary-on-dark">
            {plate ? <>Plate {plate}</> : null}
            {plate && v.vin ? <span className="mx-1.5 opacity-50">·</span> : null}
            {v.vin ? <>VIN {v.vin}</> : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Route card — two compact rows. Tapping the Navigate button now
 * launches turn-by-turn navigation directly via the Google Maps
 * `dir_action=navigate` URL scheme instead of just opening the
 * destination pin. One tap from here to driving.
 */
function RouteCard({ job }: { job: JobDto }): JSX.Element {
  const pickup = job.pickupAddress;
  const dropoff = job.dropoffAddress;
  return (
    <Card className="mb-3">
      <CardContent className="space-y-1.5 p-3">
        <RouteRow tone="brand" label="Pickup" address={pickup} />
        {dropoff ? <RouteRow tone="ok" label="Dropoff" address={dropoff} /> : null}
      </CardContent>
    </Card>
  );
}

function RouteRow({
  tone,
  label,
  address,
}: {
  tone: 'brand' | 'ok';
  label: string;
  address: string | null;
}): JSX.Element {
  const pinClass = tone === 'brand' ? 'text-brand-primary' : 'text-ok';
  return (
    <div className="flex items-center gap-2">
      <MapPin className={`h-4 w-4 shrink-0 ${pinClass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{address ?? '—'}</p>
        <p className="text-[10px] uppercase tracking-wide text-text-secondary-on-dark">{label}</p>
      </div>
      {address ? (
        <a
          href={mapsUrl(address)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-primary px-3 text-sm font-semibold text-brand-primary-foreground"
          aria-label={`Navigate to ${label}`}
        >
          <Navigation className="h-4 w-4" />
          Navigate
        </a>
      ) : null}
    </div>
  );
}

/**
 * Office notes card. Renders the dispatch-typed instructions on the
 * job (the `notes` field on JobDto) only when the office actually
 * filled it in. Read-only — the driver can't edit these. Drivers add
 * their own notes through the Notes card lower on the page.
 */
function OfficeNotesCard({ job }: { job: JobDto }): JSX.Element | null {
  const notes = job.notes?.trim();
  if (!notes) return null;
  return (
    <Card className="mb-3 border-amber-500/40 bg-amber-500/5">
      <CardContent className="space-y-1 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          <StickyNote className="h-3.5 w-3.5" />
          Office notes
        </p>
        <p className="whitespace-pre-wrap text-sm leading-snug">{notes}</p>
      </CardContent>
    </Card>
  );
}

/** Per-claim photo cap. 15 is the business rule from the founder. */
const PHOTO_CAP = 15;
/** Per-video duration cap, in seconds. */
const VIDEO_DURATION_CAP_SECONDS = 120;

function PhotoTab({
  evidence,
  onCapture,
}: {
  evidence: EvidenceEntry[];
  onCapture: (file: File) => void | Promise<void>;
}): JSX.Element {
  const photos = evidence.filter((e) => e.kind.startsWith('photo'));
  const atCap = photos.length >= PHOTO_CAP;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-text-secondary-on-dark">Photos</p>
        <p
          className={`text-xs font-mono ${
            atCap ? 'text-status-warning' : 'text-text-secondary-on-dark'
          }`}
        >
          {photos.length} / {PHOTO_CAP}
        </p>
      </div>
      <label
        className={`flex h-14 items-center justify-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated text-sm font-semibold ${
          atCap ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      >
        <Camera className="h-5 w-5" />
        {atCap ? `Limit — ${PHOTO_CAP} max per file` : 'Take a photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          disabled={atCap}
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            const room = Math.max(0, PHOTO_CAP - photos.length);
            for (const file of files.slice(0, room)) void onCapture(file);
            if (files.length > room) {
              window.alert(
                `Only ${room} of ${files.length} photos uploaded — ${PHOTO_CAP} per claim is the limit.`,
              );
            }
            e.target.value = '';
          }}
        />
      </label>
      {photos.length === 0 ? (
        <p className="text-xs text-text-secondary-on-dark">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <li
              key={p.id}
              className="flex aspect-square items-center justify-center rounded-[8px] border border-divider bg-bg-surface-elevated text-[10px] text-text-secondary-on-dark"
              title={p.s3Key}
            >
              <span className="px-1 text-center">{new Date(p.createdAt).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VideoTab({
  evidence,
  onCapture,
}: {
  evidence: EvidenceEntry[];
  onCapture: (file: File) => void | Promise<void>;
}): JSX.Element {
  const videos = evidence.filter((e) => e.kind.startsWith('video'));

  // Read the duration of the selected file (browser-side, before upload)
  // and reject anything over the cap so dispatch never receives a 5-minute
  // damage walkaround that would blow the storage budget.
  async function getDurationSeconds(file: File): Promise<number> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(v.duration) ? v.duration : 0);
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-text-secondary-on-dark">
        Walkaround video · max {VIDEO_DURATION_CAP_SECONDS}s per clip
      </p>
      <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated text-sm font-semibold">
        <Video className="h-5 w-5" />
        Capture walkaround video
        <input
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const duration = await getDurationSeconds(file);
            if (duration > VIDEO_DURATION_CAP_SECONDS + 1) {
              window.alert(
                `That clip is ${Math.round(duration)}s. ${VIDEO_DURATION_CAP_SECONDS}s is the max per video. Trim it and try again.`,
              );
              return;
            }
            void onCapture(file);
          }}
        />
      </label>
      {videos.length === 0 ? (
        <p className="text-xs text-text-secondary-on-dark">No video yet.</p>
      ) : (
        <ul className="space-y-2">
          {videos.map((v) => (
            <li
              key={v.id}
              className="rounded-[10px] border border-divider p-3 text-xs text-text-secondary-on-dark"
            >
              {new Date(v.createdAt).toLocaleString()} — {v.uploadStatus}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SignatureTab({ job, onSaved }: { job: JobDto; onSaved: () => void }): JSX.Element {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const phone = job.customer?.phone ?? null;
  const customerName = job.customer?.name ?? 'the customer';
  const releaseMessage = `Hi ${customerName}, your signed liability release for tow #${job.jobNumber} is on file with the operator. Reply to this number if you need a copy. — US Tow Alliance`;
  const smsHref = phone
    ? `sms:${phone.replace(/[^+\d]/g, '')}?&body=${encodeURIComponent(releaseMessage)}`
    : null;

  async function save(): Promise<void> {
    if (!padRef.current || padRef.current.isEmpty()) {
      window.alert('Signature is empty — ask the customer to sign first.');
      return;
    }
    setBusy(true);
    try {
      const blob = await padRef.current.toBlob();
      if (!blob) throw new Error('Could not encode signature');
      const file = new File([blob], `signature-${Date.now()}.png`, { type: 'image/png' });
      await uploadEvidence({
        jobId: job.id,
        kind: 'signature_customer',
        file,
      });
      padRef.current.clear();
      setSavedAt(new Date());
      onSaved();
    } catch (err) {
      window.alert(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-on-dark">
        Customer signs to release the operator from liability for pre-existing damage documented in
        the photos above.
      </p>
      <SignaturePad ref={padRef} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => padRef.current?.clear()}>
          <Trash2 className="h-4 w-4" />
          Clear
        </Button>
        <Button className="flex-1" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save signature'}
        </Button>
      </div>
      {/* After a signature lands, surface a one-tap "text a copy to the
         customer" button. We launch the driver's native messaging app
         with the customer's number + a prefilled body — same UX as a
         CRM-managed SMS for the customer's inbox, with zero new
         outbound SMS infra cost on our side. */}
      {savedAt && smsHref ? (
        <a
          href={smsHref}
          className="flex h-11 items-center justify-center gap-2 rounded-full border border-divider bg-bg-surface-elevated text-sm font-semibold"
        >
          <Phone className="h-4 w-4" />
          Text release confirmation to customer
        </a>
      ) : null}
      {savedAt && !smsHref ? (
        <p className="text-xs text-text-secondary-on-dark">
          Signature saved. Customer phone not on file — no text sent.
        </p>
      ) : null}
    </div>
  );
}

function PaymentDialog({
  job,
  shift,
  open,
  onOpenChange,
}: {
  job: JobDto;
  shift: DriverShiftDto | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
}): JSX.Element {
  const [amount, setAmount] = useState('');
  const [tip, setTip] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<{ id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const amountCents = Math.round(Number(amount) * 100);
      const tipCents = Math.round(Number(tip || '0') * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        setError('Enter an amount in dollars');
        setBusy(false);
        return;
      }
      const body: Record<string, unknown> = {
        jobId: job.id,
        amountCents,
        tipCents,
        currency: 'usd',
        paymentMethod: 'card_present_tap',
      };
      if (email.trim()) body.receiptEmail = email.trim();
      if (shift?.id) body.shiftId = shift.id;
      const res = await driverApi<{ id: string; status: string }>(
        'POST',
        '/job-field-payments/create-intent',
        body,
      );
      setIntent({ id: res.id, status: res.status });
    } catch (err) {
      setError(err instanceof DriverApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function capture(): Promise<void> {
    if (!intent) return;
    setBusy(true);
    try {
      const res = await driverApi<{ id: string; status: string }>(
        'POST',
        `/job-field-payments/${intent.id}/capture`,
      );
      setIntent({ id: res.id, status: res.status });
    } catch (err) {
      setError(err instanceof DriverApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Capture payment</DialogTitle>
          <DialogDescription>
            Tap-to-pay or chip-card via Stripe Terminal. Session 3 uses the stub provider — Session
            5 wires in the real SDK.
          </DialogDescription>
        </DialogHeader>
        {!intent ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-14"
              />
            </div>
            <div>
              <Label htmlFor="tip">Tip (optional)</Label>
              <Input
                id="tip"
                inputMode="decimal"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
                className="h-14"
              />
            </div>
            <div>
              <Label htmlFor="receipt">Receipt email (optional)</Label>
              <Input
                id="receipt"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14"
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void create()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create intent'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Intent created — status <span className="font-mono">{intent.status}</span>
            </p>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {intent.status !== 'captured' ? (
                <Button onClick={() => void capture()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Capture'}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Voice-dictation button for the driver notes composer. Wraps the Web
 * Speech API (SpeechRecognition / webkitSpeechRecognition) so the
 * driver can dictate by voice instead of thumb-typing while in the
 * truck. Falls back to a disabled state on browsers that don't support
 * it (mostly Firefox — Chrome + Safari + Edge all do).
 */
function VoiceDictateButton({
  onResult,
}: {
  onResult: (text: string) => void;
}): JSX.Element {
  const [listening, setListening] = useState(false);
  const recRef = useRef<unknown>(null);
  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  function start(): void {
    if (!supported) {
      window.alert('Voice dictation is not supported in this browser. Try Chrome or Safari.');
      return;
    }
    // biome-ignore lint/suspicious/noExplicitAny: Web Speech API typings vary by browser
    const Ctor: any =
      // biome-ignore lint/suspicious/noExplicitAny: same
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    // biome-ignore lint/suspicious/noExplicitAny: same
    const rec: any = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => {
      const text = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
      if (text) onResult(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stop(): void {
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    const rec = recRef.current as any;
    rec?.stop?.();
    setListening(false);
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      disabled={!supported}
      className={`flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold ${
        listening
          ? 'bg-danger text-danger-foreground'
          : 'border border-divider bg-bg-surface-elevated text-text-primary-on-dark'
      } ${supported ? '' : 'opacity-50'}`}
      aria-label={listening ? 'Stop dictation' : 'Start voice dictation'}
    >
      <Mic className="h-4 w-4" />
      {listening ? 'Listening…' : 'Dictate'}
    </button>
  );
}

function badgeToneForStatus(s: JobStatus): 'neutral' | 'info' | 'warn' | 'ok' | 'brand' {
  if (s === 'dispatched') return 'info';
  if (s === 'enroute' || s === 'on_scene') return 'warn';
  if (s === 'in_progress') return 'brand';
  if (s === 'completed') return 'ok';
  return 'neutral';
}

/**
 * Build a Google Maps URL that launches turn-by-turn navigation
 * directly when tapped on mobile, rather than just showing the
 * destination pin on a map. On iOS this hands off to Google Maps if
 * installed (then Apple Maps as the fallback handler for the
 * universal link); on Android it opens Google Maps and starts
 * directions from the user's current location.
 *
 * Reference: https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */
function mapsUrl(address: string | null): string {
  if (!address) return '#';
  const encoded = encodeURIComponent(address);
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving&dir_action=navigate`;
}
