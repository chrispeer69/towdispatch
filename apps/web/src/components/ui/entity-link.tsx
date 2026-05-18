/**
 * Shared link components for customer / job references throughout the
 * operator UI. Use these in place of plain text whenever a customer name
 * or job number/id is displayed, so the operator can click anywhere to
 * deep-link to the detail view.
 *
 * Style: subtle underline on hover, brand-primary text on hover, no
 * decoration when at rest. Inherits font from parent so the link blends
 * into table cells, list rows, and inline copy.
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

interface BaseProps {
  className?: string;
  /** When true, renders as a plain span (used when the wrapping row is itself a link). */
  asText?: boolean;
}

export function CustomerLink({
  customerId,
  children,
  className,
  asText,
}: BaseProps & { customerId: string; children: ReactNode }): JSX.Element {
  if (asText) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      href={`/customers/${customerId}`}
      className={
        className ??
        'text-text-primary-on-dark hover:text-brand-primary hover:underline underline-offset-2 transition-colors'
      }
    >
      {children}
    </Link>
  );
}

export function JobLink({
  jobId,
  children,
  className,
  asText,
}: BaseProps & { jobId: string; children: ReactNode }): JSX.Element {
  if (asText) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      href={`/jobs/${jobId}`}
      className={
        className ??
        'text-text-primary-on-dark hover:text-brand-primary hover:underline underline-offset-2 transition-colors'
      }
    >
      {children}
    </Link>
  );
}

export function VehicleLink({
  vehicleId,
  children,
  className,
  asText,
}: BaseProps & { vehicleId: string; children: ReactNode }): JSX.Element {
  if (asText) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      href={`/vehicles/${vehicleId}`}
      className={
        className ??
        'text-text-primary-on-dark hover:text-brand-primary hover:underline underline-offset-2 transition-colors'
      }
    >
      {children}
    </Link>
  );
}

export function InvoiceLink({
  invoiceId,
  children,
  className,
  asText,
}: BaseProps & { invoiceId: string; children: ReactNode }): JSX.Element {
  if (asText) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      href={`/billing/invoices/${invoiceId}`}
      className={
        className ??
        'text-text-primary-on-dark hover:text-brand-primary hover:underline underline-offset-2 transition-colors'
      }
    >
      {children}
    </Link>
  );
}
