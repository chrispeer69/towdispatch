'use client';

/**
 * Demo intake stub — shows a preview of the call intake form.
 */

import { PhoneCall } from 'lucide-react';
import Link from 'next/link';

export default function DemoIntakePage(): JSX.Element {
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <PhoneCall className="h-5 w-5 text-brand-primary" />
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
            New Call Intake
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Demo preview of the call intake workflow
          </p>
        </div>
      </header>

      <div className="rounded-[14px] border border-divider bg-bg-surface p-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Customer section */}
          <div className="space-y-4">
            <h3 className="font-condensed text-base font-extrabold uppercase tracking-wide">
              Customer
            </h3>
            <div className="space-y-3">
              <div>
                <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                  Account
                </p>
                <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                  AAA Southwest
                </div>
              </div>
              <div>
                <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                  Caller Name
                </p>
                <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                  John Smith
                </div>
              </div>
              <div>
                <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                  Phone
                </p>
                <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                  (602) 555-0123
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle section */}
          <div className="space-y-4">
            <h3 className="font-condensed text-base font-extrabold uppercase tracking-wide">
              Vehicle
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                    Year
                  </p>
                  <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                    2021
                  </div>
                </div>
                <div>
                  <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                    Make
                  </p>
                  <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                    Honda
                  </div>
                </div>
                <div>
                  <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                    Model
                  </p>
                  <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                    Accord
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                  Service Type
                </p>
                <div className="rounded-[8px] border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-sm font-semibold text-brand-primary">
                  Tow
                </div>
              </div>
              <div>
                <p className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
                  Pickup Location
                </p>
                <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-primary-on-dark">
                  4521 E McDowell Rd, Phoenix, AZ 85008
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="mt-6 space-y-2">
          <p className="block text-xs font-medium uppercase tracking-wide text-text-secondary-on-dark/60">
            Dispatch Notes
          </p>
          <div className="rounded-[8px] border border-divider bg-bg-surface-elevated px-3 py-2 text-sm text-text-secondary-on-dark">
            Vehicle in parking lot, keys with security. Customer requesting tow to dealer.
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex items-center justify-between border-t border-divider pt-6">
          <p className="text-xs text-text-secondary-on-dark/60">
            Demo mode — sign up to dispatch real calls
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/demo"
              className="rounded-[8px] border border-divider bg-bg-surface-elevated px-4 py-2 text-sm font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
            >
              Cancel
            </Link>
            <button
              type="button"
              className="rounded-[8px] bg-brand-primary-hover px-6 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-primary"
            >
              Dispatch Call →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
