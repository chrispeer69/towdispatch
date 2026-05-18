import { DriverAuthGate } from '@/components/driver/driver-auth-gate';
import { ServiceWorkerRegister } from '@/components/driver/service-worker-register';
import { ErrorBoundary } from '@/components/error-boundary';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Driver — US Tow DISPATCH',
  description: 'In-truck driver workspace',
};

/**
 * Top-level layout for /driver/*. Renders inside the root layout so it
 * inherits the ThemeProvider + global font, but it intentionally sits
 * OUTSIDE the (app) operator route group — drivers never see the
 * operator sidebar or shell.
 */
export default function DriverLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary>
      <ServiceWorkerRegister />
      <DriverAuthGate>{children}</DriverAuthGate>
    </ErrorBoundary>
  );
}
