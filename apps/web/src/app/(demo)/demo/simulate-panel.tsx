'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SIMULATION_MESSAGES, SIMULATION_ROUTE } from './mock-data';

// ─── Types ──────────────────────────────────────────────────────────

type SimStatus = 'idle' | 'dispatched' | 'enroute' | 'on_scene' | 'in_progress' | 'completed';

interface SimMessage {
  id: string;
  body: string;
  time: string;
}

const STATUS_FLOW: SimStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress', 'completed'];

const STATUS_LABELS: Record<SimStatus, string> = {
  idle: 'Ready',
  dispatched: 'Driver Assigned',
  enroute: 'Driver En Route',
  on_scene: 'Driver On Scene',
  in_progress: 'Service In Progress',
  completed: 'Service Complete',
};

const STATUS_COLORS: Record<SimStatus, string> = {
  idle: '#94A3B8',
  dispatched: '#3B82F6',
  enroute: '#F59E0B',
  on_scene: '#10B981',
  in_progress: '#8B5CF6',
  completed: '#10B981',
};

const _ETA_SEQUENCE = [12, 10, 8, 5, 3, 0];

// ─── Component ──────────────────────────────────────────────────────

export function SimulatePanel(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<SimStatus>('idle');
  const [routeProgress, setRouteProgress] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  const messagesLen = messages.length;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesLen]);

  const reset = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setStatus('idle');
    setRouteProgress(0);
    setEta(null);
    setMessages([]);
    setIsRunning(false);
  }, []);

  const startSimulation = useCallback(() => {
    reset();
    setIsRunning(true);

    // Status transitions
    const statusTimings = [
      { status: 'dispatched' as SimStatus, delay: 1000 },
      { status: 'enroute' as SimStatus, delay: 3000 },
      { status: 'on_scene' as SimStatus, delay: 16000 },
      { status: 'in_progress' as SimStatus, delay: 20000 },
      { status: 'completed' as SimStatus, delay: 27000 },
    ];

    for (const { status: s, delay } of statusTimings) {
      timersRef.current.push(setTimeout(() => setStatus(s), delay));
    }

    // ETA countdown
    const etaTimings = [
      { eta: 12, delay: 3000 },
      { eta: 10, delay: 6000 },
      { eta: 8, delay: 9000 },
      { eta: 5, delay: 12000 },
      { eta: 3, delay: 14000 },
      { eta: 0, delay: 16000 },
    ];
    for (const { eta: e, delay } of etaTimings) {
      timersRef.current.push(setTimeout(() => setEta(e), delay));
    }

    // Messages
    SIMULATION_MESSAGES.forEach((msg, index) => {
      timersRef.current.push(
        setTimeout(
          () => {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}-${Math.random()}`,
                body: msg.body,
                time: new Date().toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              },
            ]);
          },
          index * 3000 + 1000,
        ),
      );
    });

    // Route animation (from 3s to 16s = en route phase)
    const routeStart = 3000;
    const routeEnd = 16000;
    const startTime = Date.now();

    function animate(): void {
      const elapsed = Date.now() - startTime;
      if (elapsed < routeStart) {
        setRouteProgress(0);
      } else if (elapsed >= routeEnd) {
        setRouteProgress(1);
        return;
      } else {
        const progress = (elapsed - routeStart) / (routeEnd - routeStart);
        setRouteProgress(Math.min(1, progress));
      }
      animFrameRef.current = requestAnimationFrame(animate);
    }
    animFrameRef.current = requestAnimationFrame(animate);

    // Auto-finish
    timersRef.current.push(
      setTimeout(() => {
        setIsRunning(false);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      }, 28000),
    );
  }, [reset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Current route position
  const totalPoints = SIMULATION_ROUTE.length - 1;
  const exactIdx = routeProgress * totalPoints;
  const segIdx = Math.min(Math.floor(exactIdx), totalPoints - 1);
  const segFrac = exactIdx - segIdx;
  const from = SIMULATION_ROUTE[segIdx];
  const to = SIMULATION_ROUTE[Math.min(segIdx + 1, totalPoints)];
  const currentLat =
    from && to ? from.lat + (to.lat - from.lat) * segFrac : (SIMULATION_ROUTE[0]?.lat ?? 0);
  const currentLng =
    from && to ? from.lng + (to.lng - from.lng) * segFrac : (SIMULATION_ROUTE[0]?.lng ?? 0);

  const statusIdx = STATUS_FLOW.indexOf(status);

  if (!isOpen) {
    return (
      <button
        id="demo-simulate-btn"
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full bg-brand-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand-primary/25 transition-all hover:bg-brand-primary-hover hover:shadow-xl hover:shadow-brand-primary/30 hover:scale-105 active:scale-100"
      >
        <span className="text-lg">▶</span>
        Simulate Driver En Route
      </button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss only */}
      <div
        className="fixed inset-0 z-[9990] bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={() => {
          if (!isRunning) {
            reset();
            setIsOpen(false);
          }
        }}
        aria-hidden
      />

      {/* Modal */}
      <div className="fixed inset-4 z-[9991] flex items-center justify-center md:inset-8 lg:inset-16">
        <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[14px] border border-divider bg-bg-base shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-divider bg-bg-surface px-5 py-3">
            <div className="flex items-center gap-3">
              <div
                className="h-3 w-3 rounded-full transition-colors duration-500"
                style={{ backgroundColor: STATUS_COLORS[status] }}
              />
              <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide">
                Live Tracking Simulation
              </h2>
              {status !== 'idle' ? (
                <span className="rounded-full border border-divider bg-bg-surface-elevated px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                  {STATUS_LABELS[status]}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                reset();
                setIsOpen(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
              aria-label="Close simulation"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
            {/* Left: Map / Route visualization */}
            <div className="flex-1 border-b border-divider p-5 md:border-b-0 md:border-r">
              {/* SVG Route visualization */}
              <div className="flex h-full flex-col items-center justify-center">
                <svg
                  viewBox="0 0 400 400"
                  className="h-full max-h-[400px] w-full max-w-[400px]"
                  role="img"
                  aria-label="Route visualization showing driver path from dispatch to customer"
                >
                  <title>Driver route visualization</title>
                  {/* Grid pattern */}
                  <defs>
                    <pattern id="demo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path
                        d="M 40 0 L 0 0 0 40"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="0.5"
                        className="text-divider/30"
                      />
                    </pattern>
                    <linearGradient id="route-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#144399" />
                      <stop offset="100%" stopColor="#F59E0B" />
                    </linearGradient>
                  </defs>
                  <rect width="400" height="400" fill="url(#demo-grid)" rx="14" />

                  {/* Route path */}
                  <path
                    d="M 60,340 C 80,300 100,280 140,250 S 180,220 220,190 S 260,160 280,140 S 310,110 330,80 L 340,60"
                    fill="none"
                    stroke="url(#route-gradient)"
                    strokeWidth="3"
                    strokeDasharray="8 4"
                    strokeLinecap="round"
                    opacity="0.6"
                  />

                  {/* Traveled path */}
                  <path
                    d="M 60,340 C 80,300 100,280 140,250 S 180,220 220,190 S 260,160 280,140 S 310,110 330,80 L 340,60"
                    fill="none"
                    stroke="url(#route-gradient)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${routeProgress * 500} 500`}
                    opacity="1"
                  />

                  {/* Start point (dispatch) */}
                  <g>
                    <circle cx="60" cy="340" r="8" fill="#144399" opacity="0.15" />
                    <circle cx="60" cy="340" r="4" fill="#144399" />
                    <text
                      x="75"
                      y="344"
                      className="text-[10px] fill-text-secondary-on-dark"
                      fontFamily="system-ui"
                    >
                      Dispatch
                    </text>
                  </g>

                  {/* End point (customer) */}
                  <g>
                    <circle cx="340" cy="60" r="8" fill="#EF4444" opacity="0.15" />
                    <circle cx="340" cy="60" r="4" fill="#EF4444" />
                    <text
                      x="275"
                      y="50"
                      className="text-[10px] fill-text-secondary-on-dark"
                      fontFamily="system-ui"
                    >
                      Customer
                    </text>
                  </g>

                  {/* Driver dot — animated */}
                  {status !== 'idle' && status !== 'completed' ? (
                    <g>
                      <circle
                        cx={60 + routeProgress * 280}
                        cy={340 - routeProgress * 280}
                        r="14"
                        fill="#F59E0B"
                        opacity="0.2"
                      >
                        <animate
                          attributeName="r"
                          values="12;18;12"
                          dur="2s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.3;0.1;0.3"
                          dur="2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                      <circle
                        cx={60 + routeProgress * 280}
                        cy={340 - routeProgress * 280}
                        r="6"
                        fill="#F59E0B"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <text
                        x={60 + routeProgress * 280 + 14}
                        y={340 - routeProgress * 280 + 4}
                        className="text-[10px] font-bold fill-text-primary-on-dark"
                        fontFamily="system-ui"
                      >
                        Mike R.
                      </text>
                    </g>
                  ) : null}

                  {/* Completed check */}
                  {status === 'completed' ? (
                    <g>
                      <circle cx="340" cy="60" r="14" fill="#10B981" opacity="0.2" />
                      <circle cx="340" cy="60" r="8" fill="#10B981" />
                      <text
                        x="336"
                        y="64"
                        fill="white"
                        fontSize="10"
                        fontFamily="system-ui"
                        fontWeight="bold"
                      >
                        ✓
                      </text>
                    </g>
                  ) : null}
                </svg>

                {/* ETA display */}
                {eta !== null && status === 'enroute' ? (
                  <div className="mt-4 text-center">
                    <span className="font-condensed text-3xl font-extrabold text-text-primary-on-dark">
                      {eta}
                    </span>
                    <span className="ml-1.5 text-sm text-text-secondary-on-dark">min ETA</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Right: Status + Messages */}
            <div className="flex w-full flex-col md:w-80">
              {/* Status timeline */}
              <div className="border-b border-divider p-4">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
                  Status Timeline
                </p>
                <div className="space-y-2">
                  {STATUS_FLOW.map((s, i) => {
                    const reached = statusIdx >= i;
                    const isCurrent = status === s;
                    return (
                      <div key={s} className="flex items-center gap-3">
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-500 ${
                            reached
                              ? 'bg-brand-primary text-white'
                              : 'border border-divider bg-bg-surface-elevated text-text-secondary-on-dark/40'
                          } ${isCurrent ? 'ring-2 ring-brand-primary/30 ring-offset-2 ring-offset-bg-base' : ''}`}
                        >
                          {reached ? '✓' : i + 1}
                        </div>
                        <span
                          className={`text-xs font-medium transition-colors duration-300 ${
                            reached ? 'text-text-primary-on-dark' : 'text-text-secondary-on-dark/40'
                          }`}
                        >
                          {STATUS_LABELS[s]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Messages */}
              <div className="flex flex-1 flex-col overflow-hidden p-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
                  Live Updates
                </p>
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-[8px] bg-bg-surface-elevated/60 px-3 py-2 text-sm animate-fade-in-up"
                    >
                      <p className="text-text-primary-on-dark">{m.body}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-text-secondary-on-dark/60">
                        {m.time}
                      </p>
                    </div>
                  ))}
                  {messages.length === 0 ? (
                    <p className="text-sm text-text-secondary-on-dark/50">
                      Updates will appear here during the simulation…
                    </p>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Driver info card */}
              <div className="border-t border-divider p-4">
                <div className="flex items-center gap-3 rounded-[10px] bg-bg-surface-elevated/40 px-3 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary text-sm font-bold text-white">
                    MR
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary-on-dark">Mike Ramos</p>
                    <p className="font-mono text-[11px] text-text-secondary-on-dark">
                      Truck #14 · 2019 Toyota Camry
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer controls */}
          <div className="flex items-center justify-between border-t border-divider bg-bg-surface px-5 py-3">
            <p className="text-xs text-text-secondary-on-dark">
              {isRunning
                ? 'Simulation running — this is what your customers see in real time.'
                : status === 'completed'
                  ? 'Simulation complete. Your customers get this exact tracking experience.'
                  : 'Click Start to see the full driver-to-customer tracking flow.'}
            </p>
            <div className="flex items-center gap-2">
              {status !== 'idle' || isRunning ? (
                <button
                  type="button"
                  onClick={() => {
                    reset();
                  }}
                  className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
                >
                  Reset
                </button>
              ) : null}
              {!isRunning && status !== 'completed' ? (
                <button
                  type="button"
                  onClick={startSimulation}
                  className="rounded-[8px] bg-brand-primary px-5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-primary-hover"
                >
                  ▶ Start Simulation
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
