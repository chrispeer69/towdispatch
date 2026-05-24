'use client';

import { Label } from '@/components/ui/label';
import * as React from 'react';

/**
 * Labeled form field with accessible error + hint wiring. Injects id +
 * aria-describedby + aria-invalid into its single input child. Shared by the
 * account step and every wizard step so a11y stays consistent.
 */
export interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps): JSX.Element {
  const id = React.useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  let enhanced: React.ReactNode = children;
  if (React.isValidElement(children)) {
    const extra: Record<string, string | boolean> = { id };
    if (describedBy) extra['aria-describedby'] = describedBy;
    if (error) extra['aria-invalid'] = true;
    enhanced = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, extra);
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {enhanced}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-text-secondary-on-dark/60">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
