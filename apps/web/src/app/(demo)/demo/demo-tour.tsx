'use client';

import type { CSSProperties, JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// ─── Tour step definitions ──────────────────────────────────────────

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  position: 'bottom' | 'right' | 'left' | 'top';
}

const STEPS: TourStep[] = [
  {
    targetId: 'demo-kpi-section',
    title: 'Operations at a Glance',
    description:
      'Active calls, revenue, and average ETA — your three most critical numbers updated in real time.',
    position: 'bottom',
  },
  {
    targetId: 'demo-drivers-section',
    title: 'Drivers On Duty',
    description:
      "See every driver's real-time status. Who's available, who's en route, who's on scene — all in one view.",
    position: 'bottom',
  },
  {
    targetId: 'demo-quick-actions',
    title: 'Quick Actions',
    description:
      'One-tap intake, add a driver, onboard a customer. The most common dispatch actions are always one click away.',
    position: 'left',
  },
  {
    targetId: 'demo-sidebar-nav',
    title: 'Full Navigation',
    description:
      'Dispatch board, jobs, fleet management, billing, reports, AI dispatch — your entire operation in one sidebar.',
    position: 'right',
  },
  {
    targetId: 'demo-sidebar-dispatch',
    title: 'Live Dispatch',
    description:
      'Click on Live Dispatch to see your fleet. You can watch a driver en-route simulation and see exactly what your customers see when tracking their tow.',
    position: 'right',
  },
  {
    targetId: 'demo-live-map-container',
    title: 'Run Simulation',
    description:
      'Click here to watch Mike Ramos complete his route. You will see his location update in real-time on the map.',
    position: 'top',
  },
  {
    targetId: 'demo-sidebar-roster',
    title: 'Driver Dispatched',
    description: 'Mike Ramos is now en route. His status updates live in the Driver Roster without refreshing the page.',
    position: 'right',
  },
  {
    targetId: 'demo-live-map-container',
    title: 'On Scene',
    description: 'Mike has arrived at the vehicle. Dispatchers can see exactly when drivers arrive on location.',
    position: 'top',
  },
  {
    targetId: 'demo-sidebar-roster',
    title: 'Service in Progress',
    description: 'The vehicle is being hooked up and loaded.',
    position: 'right',
  },
  {
    targetId: 'demo-live-map-container',
    title: 'Towing to Destination',
    description: 'The vehicle has been loaded and the driver is en route to the dropoff location.',
    position: 'top',
  },
  {
    targetId: 'demo-sidebar-roster',
    title: 'Job Completed!',
    description: 'The job is done. The driver instantly drops back into Available status in the roster, ready for the next call.',
    position: 'right',
  },
];

const STORAGE_KEY = 'ustd-demo-tour-dismissed';

// ─── Component ──────────────────────────────────────────────────────

export function DemoTour(): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({});
  const [spotlightStyle, setSpotlightStyle] = useState<CSSProperties>({});
  const tooltipRef = useRef<HTMLElement>(null);

  // Auto-advance to step 6 when navigating to Live Dispatch
  useEffect(() => {
    if (pathname === '/demo/dispatch' && currentStep === 4) {
      setCurrentStep(5);
    }
  }, [pathname, currentStep]);

  // Drive simulation based on step changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('demo-tour-step', { detail: currentStep }));
  }, [currentStep]);

  // Advance if they click the simulation button
  useEffect(() => {
    function handleSimStart() {
      setIsVisible(true);
      setCurrentStep(6);
    }
    window.addEventListener('demo-sim-start', handleSimStart);
    return () => window.removeEventListener('demo-sim-start', handleSimStart);
  }, []);

  // Reset demo
  useEffect(() => {
    function handleReset() {
      setCurrentStep(5);
    }
    window.addEventListener('demo-tour-reset', handleReset);
    return () => window.removeEventListener('demo-tour-reset', handleReset);
  }, []);

  // Show tour on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    setIsVisible(false);
  }, []);

  // ESC key to exit
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') dismiss();
    }
    if (isVisible) {
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }
  }, [isVisible, dismiss]);

  // Position the tooltip relative to the target element
  useEffect(() => {
    if (!isVisible) return;

    function positionTooltip(): void {
      const step = STEPS[currentStep];
      if (!step) return;
      const el = document.getElementById(step.targetId);
      if (!el) {
        return;
      }

      const rect = el.getBoundingClientRect();
      const pad = 12;
      const spotPad = 8;

      // Spotlight
      setSpotlightStyle({
        top: rect.top - spotPad + window.scrollY,
        left: rect.left - spotPad,
        width: rect.width + spotPad * 2,
        height: rect.height + spotPad * 2,
      });

      // Tooltip positioning
      const tooltipWidth = 340;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 200;

      let top = 0;
      let left = 0;

      switch (step.position) {
        case 'bottom':
          top = rect.bottom + pad + window.scrollY;
          left = Math.max(16, rect.left + rect.width / 2 - tooltipWidth / 2);
          break;
        case 'top':
          top = rect.top - tooltipHeight - pad + window.scrollY;
          left = Math.max(16, rect.left + rect.width / 2 - tooltipWidth / 2);
          break;
        case 'right':
          top = rect.top + window.scrollY;
          left = rect.right + pad;
          break;
        case 'left':
          top = rect.top + window.scrollY;
          left = rect.left - tooltipWidth - pad;
          break;
      }

      // Clamp to viewport
      left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));

      setTooltipStyle({ top, left, width: tooltipWidth });
    }

    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
    };
  }, [isVisible, currentStep]);

  if (!isVisible) return null;

  const step = STEPS[currentStep];
  if (!step) return null;

  const isLast = currentStep === STEPS.length - 1;
  const isFirst = currentStep === 0;

  return (
    <>
      {/* Backdrop overlay — transparent, just catches outside clicks */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss only — ESC key handled separately */}
      <div
        className="fixed inset-0 z-[9998] bg-transparent transition-opacity duration-300"
        onClick={dismiss}
        aria-hidden
      />

      {/* Spotlight cutout */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: interactive tour steps */}
      <div
        className={`absolute z-[9999] rounded-[14px] ring-2 ring-brand-primary/60 transition-all duration-500 ease-out ${
          currentStep >= 4 ? 'cursor-pointer pointer-events-auto hover:bg-brand-primary/20' : 'pointer-events-none'
        }`}
        style={{
          ...spotlightStyle,
          boxShadow: currentStep >= 6 ? 'none' : '0 0 0 9999px rgba(0,0,0,0.7)',
        }}
        onClick={() => {
          if (currentStep === 4) {
            router.push('/demo/dispatch');
          } else if (currentStep === 5) {
            document.getElementById('demo-map-simulate-btn')?.click();
          }
        }}
      />

      {/* Tooltip */}
      <section
        ref={tooltipRef}
        className="absolute z-[10000] rounded-[14px] border border-divider bg-bg-surface p-5 shadow-2xl transition-all duration-500 ease-out"
        style={tooltipStyle}
        aria-label={`Tour step ${currentStep + 1} of ${STEPS.length}`}
      >
        {/* Close button — always visible */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-text-secondary-on-dark transition-colors hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          aria-label="Close tour"
        >
          ✕
        </button>

        {/* Step counter */}
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-secondary-on-dark/60">
          Step {currentStep + 1} of {STEPS.length}
        </p>

        <h3 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          {step.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary-on-dark">
          {step.description}
        </p>

        <div className="mt-4 flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={`dot-${i}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? 'w-6 bg-brand-primary'
                  : i < currentStep
                    ? 'w-1.5 bg-brand-primary/50'
                    : 'w-1.5 bg-divider'
              }`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-between">
          {!isLast ? (
            <button
              type="button"
              onClick={dismiss}
              className="text-xs font-medium text-text-secondary-on-dark underline underline-offset-2 transition-colors hover:text-text-primary-on-dark"
            >
              Skip Tour
            </button>
          ) : (
            <div /> // placeholder for spacing
          )}
          <div className="flex items-center gap-2">
            {!isFirst ? (
              <button
                type="button"
                onClick={() => setCurrentStep((s) => s - 1)}
                className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
              >
                Back
              </button>
            ) : null}
            
            {isLast ? (
              <button
                type="button"
                onClick={dismiss}
                className="rounded-[8px] bg-brand-primary px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-primary-hover"
              >
                Done
              </button>
            ) : currentStep !== 4 ? (
              <button
                type="button"
                onClick={() => {
                  if (currentStep === 5) {
                    setCurrentStep(6);
                  } else {
                    setCurrentStep((s) => s + 1);
                  }
                }}
                className="rounded-[8px] bg-brand-primary px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-primary-hover"
              >
                Next
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
