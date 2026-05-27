'use client';

import { DispatchMap } from '@/app/(app)/dispatch/dispatch-map';
import { MapPin, Play } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { SIMULATION_MESSAGES, SIMULATION_ROUTE } from '../mock-data';

// ─── Types ──────────────────────────────────────────────────────────

export type SimStatus = 'idle' | 'dispatched' | 'enroute' | 'on_scene' | 'in_progress' | 'towing' | 'completed';

interface SimMessage {
  id: string;
  body: string;
  time: string;
}

const STATUS_FLOW: SimStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress', 'towing', 'completed'];

const STATUS_LABELS: Record<SimStatus, string> = {
  idle: 'Ready',
  dispatched: 'Driver Assigned',
  enroute: 'Driver En Route',
  on_scene: 'Driver On Scene',
  in_progress: 'Service In Progress',
  towing: 'Towing to Destination',
  completed: 'Service Complete',
};

const STATUS_COLORS: Record<SimStatus, string> = {
  idle: '#94A3B8',
  dispatched: '#3B82F6',
  enroute: '#F59E0B',
  on_scene: '#10B981',
  in_progress: '#8B5CF6',
  towing: '#06B6D4',
  completed: '#10B981',
};

const STATE_TARGETS: Record<SimStatus, number> = {
  idle: 0,
  dispatched: 0,
  enroute: 9 / 12,
  on_scene: 9 / 12,
  in_progress: 9 / 12,
  towing: 1,
  completed: 1,
};

export function DemoMapPane({
  roster,
  jobs,
  mapboxToken,
  onSimUpdate,
}: {
  roster: any[];
  jobs: any[];
  mapboxToken: string | null;
  onSimUpdate?: (status: SimStatus) => void;
}) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState(0); // 0 to 1
  
  // Simulation states
  const [status, setStatus] = useState<SimStatus>('idle');
  const [eta, setEta] = useState<number | null>(null);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  
  const currentProgressRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Listen to tour updates to drive the simulation!
  useEffect(() => {
    function handleTourStep(e: Event) {
      const step = (e as CustomEvent).detail;
      let nextStatus: SimStatus = 'idle';
      if (step < 6) nextStatus = 'idle';
      else if (step === 6) nextStatus = 'dispatched';
      else if (step === 7) nextStatus = 'enroute';
      else if (step === 8) nextStatus = 'on_scene';
      else if (step === 9) nextStatus = 'in_progress';
      else if (step === 10) nextStatus = 'towing';
      else if (step >= 11) nextStatus = 'completed';
      
      if (nextStatus !== 'idle') setIsSimulating(true);
      else setIsSimulating(false);
      
      setStatus(nextStatus);
      onSimUpdate?.(nextStatus);
    }
    window.addEventListener('demo-tour-step', handleTourStep);
    return () => window.removeEventListener('demo-tour-step', handleTourStep);
  }, [onSimUpdate]);

  // Animate progress and update ETA/Messages based on current status
  useEffect(() => {
    // Populate messages up to current status
    const currentStatusIdx = STATUS_FLOW.indexOf(status);
    if (currentStatusIdx >= 0) {
      const newMessages = SIMULATION_MESSAGES
        .filter(m => STATUS_FLOW.indexOf(m.status as SimStatus) <= currentStatusIdx)
        .map((m, i) => ({
          id: `msg-${m.status}-${i}`,
          body: m.body,
          time: (m as any).timeStr,
        }));
      setMessages(newMessages);
    } else {
      setMessages([]);
    }

    // Set ETA based on status
    if (status === 'dispatched') setEta(12);
    else if (status === 'enroute') setEta(5);
    else setEta(null);

    // Animate the truck to the target position
    const target = STATE_TARGETS[status];
    let frameId: number;
    
    function animate() {
      const diff = target - currentProgressRef.current;
      if (Math.abs(diff) > 0.002) {
        // Truck speed: 0.3% of route per frame (~4s for 9/12 segment)
        const speed = 0.003;
        currentProgressRef.current += Math.sign(diff) * Math.min(speed, Math.abs(diff));
        setSimProgress(currentProgressRef.current);
        frameId = requestAnimationFrame(animate);
      } else {
        currentProgressRef.current = target;
        setSimProgress(currentProgressRef.current);
      }
    }
    
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [status]);

  // Calculate current simulated driver position
  let simulatedLat = SIMULATION_ROUTE[0].lat;
  let simulatedLng = SIMULATION_ROUTE[0].lng;

  if (status !== 'idle') {
    const totalPoints = SIMULATION_ROUTE.length - 1;
    const exactIdx = simProgress * totalPoints;
    const segIdx = Math.min(Math.floor(exactIdx), totalPoints - 1);
    const segFrac = exactIdx - segIdx;
    const from = SIMULATION_ROUTE[segIdx];
    const to = SIMULATION_ROUTE[Math.min(segIdx + 1, totalPoints)];
    
    simulatedLat = from && to ? from.lat + (to.lat - from.lat) * segFrac : from.lat;
    simulatedLng = from && to ? from.lng + (to.lng - from.lng) * segFrac : from.lng;
  }

  // Memoize random offsets so markers don't jitter 60 times a second
  const driverOffsets = useRef(roster.map(() => ({
    lat: (Math.random() - 0.5) * 0.02,
    lng: (Math.random() - 0.5) * 0.02,
  }))).current;

  const jobOffsets = useRef(jobs.map(() => ({
    lat: (Math.random() - 0.5) * 0.05,
    lng: (Math.random() - 0.5) * 0.05,
  }))).current;

  // Inject the simulated position into the Mike Ramos driver and format to DriverRosterRow
  const mappedRoster = roster.map((r, i) => {
    const isMike = r.firstName === 'Mike' && r.lastName === 'Ramos';
    const offset = driverOffsets[i] || { lat: 0, lng: 0 };
    
    // During simulation, update Mike's status
    const currentShiftStatus = isMike && status !== 'idle' ? status : r.shiftStatus;
    
    return {
      driver: { id: r.driverId, firstName: r.firstName, lastName: r.lastName },
      shift: r.shiftStatus !== 'available' ? {
        id: `shift-${r.driverId}`,
        status: currentShiftStatus,
        lastLat: isMike ? simulatedLat : SIMULATION_ROUTE[0].lat + offset.lat,
        lastLng: isMike ? simulatedLng : SIMULATION_ROUTE[0].lng + offset.lng,
        lastPositionAt: new Date().toISOString(),
      } : undefined,
      truck: r.truckUnitNumber ? { id: `truck-${r.truckUnitNumber}`, unitNumber: r.truckUnitNumber } : undefined,
      currentJobNumber: r.currentJobNumber || undefined,
      currentJobId: r.currentJobId || undefined,
    };
  });

  const mappedJobs = jobs.map((j, i) => {
    const offset = jobOffsets[i] || { lat: 0, lng: 0 };
    return {
      ...j,
      pickupLat: i === 0 ? SIMULATION_ROUTE[9].lat : SIMULATION_ROUTE[0].lat + offset.lat,
      pickupLng: i === 0 ? SIMULATION_ROUTE[9].lng : SIMULATION_ROUTE[0].lng + offset.lng,
      dropoffLat: i === 0 ? SIMULATION_ROUTE[12].lat : undefined,
      dropoffLng: i === 0 ? SIMULATION_ROUTE[12].lng : undefined,
    };
  });
  
  const statusIdx = STATUS_FLOW.indexOf(status);

  return (
    <section className="relative rounded-[14px] border border-divider bg-bg-surface/40 p-4 h-full flex flex-col min-h-[500px]">
      <header className="flex items-center justify-between pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Live Dispatch Map
          </h2>
          {status !== 'idle' ? (
            <span className="rounded-full border border-divider bg-bg-surface-elevated px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
              Simulation: {STATUS_LABELS[status]}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-text-secondary-on-dark">
            <MapPin className="inline h-3.5 w-3.5" /> Mapbox
          </span>
          {status !== 'idle' ? (
             <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('demo-tour-reset'))}
                className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
              >
                Reset Demo
              </button>
          ) : null}
        </div>
      </header>

      <div id="demo-live-map-container" className="relative flex-1 min-h-[420px] rounded-md overflow-hidden">
        <DispatchMap token={mapboxToken} roster={mappedRoster as any} jobs={mappedJobs as any} />

        {status === 'idle' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-[2px] rounded-md transition-opacity">
            <div className="text-center p-6 bg-bg-surface border border-brand-primary/50 shadow-2xl rounded-xl">
              <p className="text-sm font-semibold mb-3 text-text-primary-on-dark">Ready to see Live Tracking in action?</p>
              <button
                id="demo-map-simulate-btn"
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('demo-sim-start'))}
                className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-brand-primary-hover hover:scale-105"
              >
                <Play className="w-4 h-4" />
                Click here to simulate
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
