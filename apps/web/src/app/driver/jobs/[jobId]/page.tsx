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

      <Card className="mb-3">
        <CardContent className="space-y-2 p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-text-secondary-on-dark">Job</p>
            <Badge tone={badgeToneForStatus(job.status)}>{STATUS_LABEL[job.status]}</Badge>
          </div>
          <h1 className="text-lg font-bold">{job.jobNumber}</h1>
          {job.authorizedByName ? (
            <p className="text-xs text-text-secondary-on-dark">
              Authorized by {job.authorizedByName}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <CustomerCard job={job} />
      <VehicleCard job={job} />
      <RouteCard job={job} />

      <Card className="mb-3">
        <CardContent className="space-y-3 p-5">
          <p className="font-semibold">Move job forward</p>
          {next.length === 0 ? (
            <p className="text-sm text-text-secondary-on-dark">
              No further transitions available from {STATUS_LABEL[job.status]}.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {next.map((to) => (
                <Button
                  key={to}
                  size="touch"
                  disabled={busyStatus === to}
                  onClick={() => void transition(to)}
                >
                  {busyStatus === to ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    (STATUS_CTA[to] ?? `Mark ${STATUS_LABEL[to]}`)
                  )}
                </Button>
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

      <Card className="mb-3">
        <CardContent className="space-y-3 p-5">
          <p className="font-semibold">Field payment</p>
          <p className="text-sm text-text-secondary-on-dark">
            Capture payment at the scene with the Stripe Terminal reader.
          </p>
          <Button
            size="touch"
            className="w-full"
            disabled={!canCapturePayment}
            onClick={() => setPaymentOpen(true)}
          >
            <CreditCard className="h-5 w-5" />
            Capture payment
          </Button>
          {!canCapturePayment ? (
            <p className="text-xs text-text-secondary-on-dark">
              Available once the job is in progress and a shift is active.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-3">
        <CardContent className="space-y-3 p-5">
          <p className="flex items-center gap-2 font-semibold">
            <StickyNote className="h-4 w-4" /> Notes
          </p>
          <Textarea
            placeholder="Add a note for dispatch (e.g., vehicle won't roll, customer changed dropoff)…"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            maxLength={2000}
          />
          <Button
            size="default"
            variant="secondary"
            disabled={!newNote.trim()}
            onClick={() => void addNote()}
          >
            Post note
          </Button>
          {notes.length === 0 ? (
            <p className="text-xs text-text-secondary-on-dark">No notes yet.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <PaymentDialog job={job} shift={shift} open={paymentOpen} onOpenChange={setPaymentOpen} />
    </DriverShell>
  );
}

function CustomerCard({ job }: { job: JobDto }): JSX.Element {
  const customer = job.customer;
  const customerName = customer?.name ?? 'Customer pending';
  const phone = customer?.phone ?? null;
  const email = customer?.email ?? null;
  // Strip everything but digits + leading + for the tel: href so the
  // dialer doesn't choke on punctuation like "(614) 555-1212".
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : null;
  const smsHref = phone ? `sms:${phone.replace(/[^+\d]/g, '')}` : null;
  return (
    <Card className="mb-3">
      <CardContent className="space-y-2 p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary-on-dark">Customer</p>
        <p className="text-lg font-semibold">{customerName}</p>
        {phone ? (
          <p className="font-mono text-sm text-text-primary-on-dark">{phone}</p>
        ) : (
          <p className="text-xs text-text-secondary-on-dark">No phone on file</p>
        )}
        {email ? <p className="break-all text-xs text-text-secondary-on-dark">{email}</p> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {telHref ? (
            <a
              href={telHref}
              className="flex h-11 items-center gap-2 rounded-full border border-divider bg-bg-surface-elevated px-4 text-sm font-semibold"
            >
              <Phone className="h-4 w-4" />
              Call
            </a>
          ) : null}
          {smsHref ? (
            <a
              href={smsHref}
              className="flex h-11 items-center gap-2 rounded-full border border-divider bg-bg-surface-elevated px-4 text-sm font-semibold"
            >
              <Phone className="h-4 w-4" />
              Text
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
function VehicleCard({ job }: { job: JobDto }): JSX.Element {
  const v = job.vehicle;
  if (!v) {
    return (
      <Card className="mb-3">
        <CardContent className="space-y-1 p-5">
          <p className="text-xs uppercase tracking-wide text-text-secondary-on-dark">Vehicle</p>
          <p className="font-semibold">Vehicle pending</p>
          <p className="text-xs text-text-secondary-on-dark">
            Service: <span className="uppercase">{job.serviceType}</span>
          </p>
        </CardContent>
      </Card>
    );
  }
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  const plate = v.plate ? `${v.plate}${v.plateState ? ` (${v.plateState})` : ''}` : null;
  return (
    <Card className="mb-3">
      <CardContent className="space-y-2 p-5">
        <p className="text-xs uppercase tracking-wide text-text-secondary-on-dark">Vehicle</p>
        <p className="text-lg font-semibold">{ymm || 'Vehicle details pending'}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {v.color ? (
            <>
              <span className="text-text-secondary-on-dark">Color</span>
              <span className="font-mono">{v.color}</span>
            </>
          ) : null}
          {plate ? (
            <>
              <span className="text-text-secondary-on-dark">Plate</span>
              <span className="font-mono">{plate}</span>
            </>
          ) : null}
          {v.vin ? (
            <>
              <span className="text-text-secondary-on-dark">VIN</span>
              <span className="break-all font-mono text-xs">{v.vin}</span>
            </>
          ) : null}
          {v.drivetrain ? (
            <>
              <span className="text-text-secondary-on-dark">Drivetrain</span>
              <span className="font-mono">{v.drivetrain}</span>
            </>
          ) : null}
        </div>
        <p className="pt-2 text-xs text-text-secondary-on-dark">
          Service: <span className="uppercase">{job.serviceType}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function RouteCard({ job }: { job: JobDto }): JSX.Element {
  const pickup = job.pickupAddress;
  const dropoff = job.dropoffAddress;
  return (
    <Card className="mb-3">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 text-brand-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-secondary-on-dark">Pickup</p>
            <p className="break-words text-sm">{pickup}</p>
            <a
              href={mapsUrl(pickup)}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex h-9 items-center gap-1 text-xs text-brand-primary underline"
            >
              <Navigation className="h-3 w-3" />
              Open in Maps
            </a>
          </div>
        </div>
        {dropoff ? (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-ok" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-secondary-on-dark">Dropoff</p>
              <p className="break-words text-sm">{dropoff}</p>
              <a
                href={mapsUrl(dropoff)}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-flex h-9 items-center gap-1 text-xs text-brand-primary underline"
              >
                <Navigation className="h-3 w-3" />
                Open in Maps
              </a>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PhotoTab({
  evidence,
  onCapture,
}: {
  evidence: EvidenceEntry[];
  onCapture: (file: File) => void | Promise<void>;
}): JSX.Element {
  const photos = evidence.filter((e) => e.kind.startsWith('photo'));
  return (
    <div className="space-y-3">
      <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated text-sm font-semibold">
        <Camera className="h-5 w-5" />
        Take a photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            for (const file of files) void onCapture(file);
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
  return (
    <div className="space-y-3">
      <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-divider bg-bg-surface-elevated text-sm font-semibold">
        <Video className="h-5 w-5" />
        Capture walkaround video
        <input
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onCapture(file);
            e.target.value = '';
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
      onSaved();
    } catch (err) {
      window.alert(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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

function badgeToneForStatus(s: JobStatus): 'neutral' | 'info' | 'warn' | 'ok' | 'brand' {
  if (s === 'dispatched') return 'info';
  if (s === 'enroute' || s === 'on_scene') return 'warn';
  if (s === 'in_progress') return 'brand';
  if (s === 'completed') return 'ok';
  return 'neutral';
}

function mapsUrl(address: string | null): string {
  if (!address) return '#';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
