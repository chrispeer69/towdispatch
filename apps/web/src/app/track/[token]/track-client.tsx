'use client';
/**
 * Customer-facing live tracking UI.
 *
 * Mobile-first. Most traffic is on phones (iOS Safari + Android Chrome are
 * the test bar). Layout: stacked single-column under sm:, sidebar layout at
 * md: and up. Map fills available height; chat lives in a sticky bottom
 * sheet that expands to full screen when tapped.
 *
 * Live updates over Socket.IO /track namespace. Auth = the URL token, sent
 * in handshake.auth.token. Server-side translates status codes to friendly
 * labels in the customer's chosen language; we never see the raw enum.
 */
import {
  TRACKING_EVENTS,
  type TrackingMessageDto,
  type TrackingPublicView,
} from '@ustowdispatch/shared';
import { type JSX, useEffect, useRef, useState } from 'react';
import { type Socket, io as ioClient } from 'socket.io-client';

interface Props {
  token: string;
  initialView: TrackingPublicView;
  lang: 'en' | 'es';
  mapboxToken: string | null;
}

const apiBase = (): string => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const COPY = {
  en: {
    requestReceived: 'Request received',
    serviceLabel: 'Service',
    pickupLabel: 'Pickup',
    dropoffLabel: 'Drop-off',
    driverLabel: 'Your driver',
    truckLabel: 'Truck',
    vehicleLabel: 'Vehicle',
    callDispatchAria: 'Call dispatcher',
    callDispatch: 'Call dispatcher',
    chatTitle: 'Messages',
    chatPlaceholder: 'Send a message to your dispatcher…',
    sendButton: 'Send',
    completedTitle: 'How was your service?',
    completedBody: 'Tap a star to rate your experience.',
    commentPlaceholder: 'Leave a note (optional)',
    submitRating: 'Submit',
    thanksTitle: 'Thanks!',
    thanksBody: 'Your feedback helps us improve.',
    locationPending: 'Driver location will appear here once your driver is on the way.',
    rateLimited: 'You are sending messages too quickly. Wait a moment and try again.',
    sendFailed: 'Could not send. Try again.',
  },
  es: {
    requestReceived: 'Solicitud recibida',
    serviceLabel: 'Servicio',
    pickupLabel: 'Recogida',
    dropoffLabel: 'Destino',
    driverLabel: 'Su conductor',
    truckLabel: 'Camión',
    vehicleLabel: 'Vehículo',
    callDispatchAria: 'Llamar al despachador',
    callDispatch: 'Llamar al despachador',
    chatTitle: 'Mensajes',
    chatPlaceholder: 'Enviar un mensaje a su despachador…',
    sendButton: 'Enviar',
    completedTitle: '¿Cómo fue su servicio?',
    completedBody: 'Toque una estrella para calificar.',
    commentPlaceholder: 'Deje un comentario (opcional)',
    submitRating: 'Enviar',
    thanksTitle: '¡Gracias!',
    thanksBody: 'Sus comentarios nos ayudan a mejorar.',
    locationPending: 'La ubicación del conductor aparecerá aquí cuando esté en camino.',
    rateLimited: 'Está enviando mensajes muy rápido. Espere un momento e inténtelo de nuevo.',
    sendFailed: 'No se pudo enviar. Inténtelo de nuevo.',
  },
};

export function TrackClient({ token, initialView, lang, mapboxToken }: Props): JSX.Element {
  const [view, setView] = useState<TrackingPublicView>(initialView);
  const [messages, setMessages] = useState<TrackingMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [stars, setStars] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(initialView.ratingSubmitted);
  const socketRef = useRef<Socket | null>(null);
  const t = COPY[lang];

  // ---------- bootstrap message thread ----------
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase()}/public/track/${encodeURIComponent(token)}/messages`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages: TrackingMessageDto[] }) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch(() => {
        // best effort — chat thread is optional
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ---------- socket lifecycle ----------
  useEffect(() => {
    let cancelled = false;
    const url = apiBase().replace(/\/$/, '');
    const sock = ioClient(`${url}/track`, {
      transports: ['websocket', 'polling'],
      auth: { token, lang },
      reconnection: true,
    });
    socketRef.current = sock;

    sock.on(TRACKING_EVENTS.STATUS_CHANGED, (payload: { status: string; statusLabel: string }) => {
      if (cancelled) return;
      setView((prev) => ({
        ...prev,
        status: payload.status,
        statusLabel: payload.statusLabel,
        completed:
          payload.status === 'completed' ||
          payload.status === 'cancelled' ||
          payload.status === 'goa',
      }));
    });

    sock.on(
      TRACKING_EVENTS.DRIVER_LOCATION,
      (p: { lat: number; lng: number; recordedAt: string | null }) => {
        if (cancelled) return;
        setView((prev) => ({ ...prev, driverLocation: p }));
      },
    );

    sock.on(TRACKING_EVENTS.MESSAGE_FROM_DISPATCH, (m: TrackingMessageDto) => {
      if (cancelled) return;
      setMessages((prev) => [...prev, m]);
    });

    return () => {
      cancelled = true;
      sock.disconnect();
      socketRef.current = null;
    };
  }, [token, lang]);

  async function send(): Promise<void> {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setSendError(null);
    try {
      const res = await fetch(`${apiBase()}/public/track/${encodeURIComponent(token)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        if (res.status === 429 || res.status === 400) {
          setSendError(t.rateLimited);
        } else {
          setSendError(t.sendFailed);
        }
        return;
      }
      const created = (await res.json()) as TrackingMessageDto;
      setMessages((prev) => [...prev, created]);
    } catch {
      setSendError(t.sendFailed);
    }
  }

  async function submitRating(): Promise<void> {
    if (stars < 1) return;
    const res = await fetch(`${apiBase()}/public/track/${encodeURIComponent(token)}/rating`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars, comment: comment || null }),
    });
    if (res.ok) {
      setRatingSubmitted(true);
    }
  }

  const tenant = view.tenant;
  const accent = tenant.accentColor ?? '#FF6A1A';
  const primary = tenant.primaryColor ?? '#1A1E2A';

  return (
    <main
      className="min-h-screen bg-steel text-text-primary"
      style={{
        // Tenant brand colors as CSS vars so child elements pick them up.
        ['--tenant-accent' as string]: accent,
        ['--tenant-primary' as string]: primary,
      }}
    >
      <header
        className="px-4 py-3 flex items-center gap-3 border-b border-white/10"
        style={{ backgroundColor: primary }}
      >
        {tenant.logoUrl ? (
          <img
            src={tenant.logoUrl}
            alt={tenant.name}
            className="h-8 w-8 rounded object-contain bg-white/10"
          />
        ) : (
          <div className="h-8 w-8 rounded bg-[color:var(--tenant-accent)]" aria-hidden />
        )}
        <div className="font-semibold">{tenant.name}</div>
        {tenant.dispatchPhone ? (
          <a
            href={`tel:${tenant.dispatchPhone}`}
            aria-label={t.callDispatchAria}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1 text-sm"
          >
            {t.callDispatch}
          </a>
        ) : null}
      </header>

      <section className="px-4 py-5 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <span className="text-text-secondary text-sm uppercase tracking-wide">
            #{view.jobNumber}
          </span>
          <LangSwitcher current={lang} token={token} />
        </div>
        <h1
          className="text-3xl font-bold mb-3"
          style={{ color: 'var(--tenant-accent)' }}
          data-testid="status-label"
        >
          {view.statusLabel}
        </h1>

        <StatusTimeline currentStatus={view.status} lang={lang} />

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label={t.serviceLabel} value={titleCase(view.serviceType)} />
          <Field label={t.pickupLabel} value={view.pickupAddress} />
          {view.dropoffAddress ? (
            <Field label={t.dropoffLabel} value={view.dropoffAddress} />
          ) : null}
          {view.vehicle ? (
            <Field
              label={t.vehicleLabel}
              value={[view.vehicle.year, view.vehicle.make, view.vehicle.model]
                .filter(Boolean)
                .join(' ')}
            />
          ) : null}
        </div>

        {view.driver ? (
          <div className="mt-5 rounded-lg bg-steel-light p-4 flex items-center gap-3">
            {view.driver.photoUrl ? (
              <img
                src={view.driver.photoUrl}
                alt={view.driver.firstName}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ backgroundColor: 'var(--tenant-accent)' }}
              >
                {view.driver.firstName.charAt(0)}
              </div>
            )}
            <div>
              <div className="font-semibold">
                {t.driverLabel}: {view.driver.firstName}
              </div>
              {view.driver.truckUnitNumber ? (
                <div className="text-text-secondary text-sm">
                  {t.truckLabel} #{view.driver.truckUnitNumber}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <MapPanel
          mapboxToken={mapboxToken}
          driverLocation={view.driverLocation}
          pickup={view.pickup}
          fallbackCopy={t.locationPending}
        />

        <ChatPanel
          title={t.chatTitle}
          messages={messages}
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          placeholder={t.chatPlaceholder}
          sendButton={t.sendButton}
          error={sendError}
        />

        {view.completed && !ratingSubmitted ? (
          <RatingPanel
            stars={stars}
            comment={comment}
            onStarsChange={setStars}
            onCommentChange={setComment}
            onSubmit={submitRating}
            title={t.completedTitle}
            body={t.completedBody}
            commentPlaceholder={t.commentPlaceholder}
            submitLabel={t.submitRating}
          />
        ) : null}
        {ratingSubmitted ? (
          <div className="mt-6 rounded-lg bg-steel-light p-4 text-center">
            <h2 className="font-semibold mb-1">{t.thanksTitle}</h2>
            <p className="text-text-secondary text-sm">{t.thanksBody}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-steel-light rounded-md px-3 py-2">
      <div className="text-text-secondary text-xs uppercase tracking-wide">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}

function StatusTimeline({
  currentStatus,
  lang,
}: {
  currentStatus: string;
  lang: 'en' | 'es';
}): JSX.Element {
  const ordered = ['dispatched', 'enroute', 'on_scene', 'in_progress', 'completed'];
  const labels: Record<string, { en: string; es: string }> = {
    dispatched: { en: 'Assigned', es: 'Asignado' },
    enroute: { en: 'On the way', es: 'En camino' },
    on_scene: { en: 'On scene', es: 'En el lugar' },
    in_progress: { en: 'In transit', es: 'En tránsito' },
    completed: { en: 'Delivered', es: 'Entregado' },
  };
  const idx = ordered.indexOf(currentStatus);
  return (
    <ol className="flex items-center gap-1 mt-2 text-xs">
      {ordered.map((step, i) => {
        const reached = idx >= i;
        return (
          <li key={step} className="flex-1 flex items-center gap-1 min-w-0">
            <span
              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
              style={{
                backgroundColor: reached ? 'var(--tenant-accent)' : '#37414F',
              }}
            />
            <span className={`truncate ${reached ? 'text-text-primary' : 'text-text-secondary'}`}>
              {labels[step]?.[lang]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function MapPanel({
  mapboxToken,
  driverLocation,
  pickup,
  fallbackCopy,
}: {
  mapboxToken: string | null;
  driverLocation: TrackingPublicView['driverLocation'];
  pickup: TrackingPublicView['pickup'];
  fallbackCopy: string;
}): JSX.Element {
  // We render a static placeholder when no Mapbox token is configured, which
  // keeps the page useful for local dev and screenshots. The interactive
  // Mapbox GL map is loaded lazily once we know we have a token AND we're
  // in the browser (it's not SSR-safe).
  if (!mapboxToken || (!driverLocation && !pickup)) {
    return (
      <div className="mt-5 rounded-lg bg-steel-light p-4 h-48 sm:h-64 flex items-center justify-center text-text-secondary text-sm text-center">
        {fallbackCopy}
      </div>
    );
  }
  // Static raster preview as a sane fallback that doesn't require the GL JS
  // bundle. Real-time pin animation is a Phase 2 polish.
  const center = driverLocation ?? pickup;
  if (!center) {
    return (
      <div className="mt-5 rounded-lg bg-steel-light p-4 h-48 flex items-center justify-center text-text-secondary text-sm">
        {fallbackCopy}
      </div>
    );
  }
  const lat = 'lat' in center ? center.lat : null;
  const lng = 'lng' in center ? center.lng : null;
  if (lat === null || lng === null) {
    return (
      <div className="mt-5 rounded-lg bg-steel-light p-4 h-48 flex items-center justify-center text-text-secondary text-sm">
        {fallbackCopy}
      </div>
    );
  }
  const driverPin = driverLocation
    ? `pin-l-car+ff6a1a(${driverLocation.lng},${driverLocation.lat})`
    : null;
  const pickupPin = pickup ? `pin-l-marker+1a1e2a(${pickup.lng},${pickup.lat})` : null;
  const pins = [driverPin, pickupPin].filter(Boolean).join(',');
  const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins}/${lng},${lat},13/640x320?access_token=${encodeURIComponent(
    mapboxToken,
  )}`;
  return (
    <div className="mt-5 rounded-lg overflow-hidden bg-steel-light h-48 sm:h-64">
      <img src={url} alt="" className="w-full h-full object-cover" />
    </div>
  );
}

function ChatPanel({
  title,
  messages,
  draft,
  onDraftChange,
  onSend,
  placeholder,
  sendButton,
  error,
}: {
  title: string;
  messages: TrackingMessageDto[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  sendButton: string;
  error: string | null;
}): JSX.Element {
  return (
    <section className="mt-6 rounded-lg bg-steel-light p-4" data-testid="chat-panel">
      <h2 className="font-semibold mb-2">{title}</h2>
      <div className="space-y-2 max-h-64 overflow-y-auto mb-3" data-testid="chat-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`text-sm rounded-md px-3 py-2 max-w-[85%] ${
              m.direction === 'inbound'
                ? 'ml-auto bg-[color:var(--tenant-accent)]/20'
                : 'bg-white/5'
            }`}
          >
            <div>{m.body}</div>
            <div className="text-text-secondary text-[11px] mt-1">
              {new Date(m.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ))}
        {messages.length === 0 ? (
          <div className="text-text-secondary text-sm">No messages yet.</div>
        ) : null}
      </div>
      {error ? <div className="text-red-300 text-xs mb-2">{error}</div> : null}
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          className="flex-1 bg-steel rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--tenant-accent)]"
          placeholder={placeholder}
          data-testid="chat-input"
        />
        <button
          type="button"
          className="rounded-md px-3 py-2 text-sm font-semibold"
          style={{ backgroundColor: 'var(--tenant-accent)', color: '#0E1117' }}
          onClick={onSend}
          data-testid="chat-send"
        >
          {sendButton}
        </button>
      </div>
    </section>
  );
}

function RatingPanel({
  stars,
  comment,
  onStarsChange,
  onCommentChange,
  onSubmit,
  title,
  body,
  commentPlaceholder,
  submitLabel,
}: {
  stars: number;
  comment: string;
  onStarsChange: (n: number) => void;
  onCommentChange: (s: string) => void;
  onSubmit: () => void;
  title: string;
  body: string;
  commentPlaceholder: string;
  submitLabel: string;
}): JSX.Element {
  return (
    <section className="mt-6 rounded-lg bg-steel-light p-4" data-testid="rating-panel">
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-text-secondary text-sm mb-3">{body}</p>
      <div className="flex gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onClick={() => onStarsChange(n)}
            className="text-2xl"
            style={{ color: n <= stars ? 'var(--tenant-accent)' : '#37414F' }}
            data-testid={`star-${n}`}
          >
            {n <= stars ? '★' : '☆'}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder={commentPlaceholder}
        rows={3}
        className="w-full bg-steel rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--tenant-accent)]"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={stars < 1}
        className="mt-3 w-full rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
        style={{ backgroundColor: 'var(--tenant-accent)', color: '#0E1117' }}
        data-testid="rating-submit"
      >
        {submitLabel}
      </button>
    </section>
  );
}

function LangSwitcher({ current, token }: { current: 'en' | 'es'; token: string }): JSX.Element {
  const other = current === 'en' ? 'es' : 'en';
  return (
    <a
      href={`/track/${encodeURIComponent(token)}?lang=${other}`}
      className="text-xs text-text-secondary hover:text-text-primary underline"
      data-testid="lang-switcher"
    >
      {other === 'es' ? 'Español' : 'English'}
    </a>
  );
}

function titleCase(s: string): string {
  return s
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
