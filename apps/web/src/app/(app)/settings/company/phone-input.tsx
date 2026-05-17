'use client';

/**
 * North-American phone input. Displays (NNN) NNN-NNNN to the operator;
 * emits E.164 (+1NNNNNNNNNN) up to the form schema. Non-NA numbers (the
 * value already starts with a "+") pass through unformatted so the
 * field stays usable for operators with non-US dispatching partners.
 */
import { Input } from '@/components/ui/input';
import type { JSX } from 'react';

interface Props {
  value: string;
  onChange: (e164: string) => void;
  disabled?: boolean;
}

export function PhoneInput({ value, onChange, disabled }: Props): JSX.Element {
  const display = formatDisplay(value);
  return (
    <Input
      type="tel"
      value={display}
      disabled={disabled}
      autoComplete="tel"
      placeholder="(555) 123-4567"
      onChange={(e) => onChange(toE164(e.target.value))}
    />
  );
}

function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    // Already E.164 or partial international — keep the leading +, strip
    // everything else non-digit.
    return `+${trimmed.replace(/\D/g, '')}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // Assume NANP if 10 digits; if 11 and starts with 1, treat as already
  // country-coded. Otherwise just emit the digits with a + prefix so a
  // typo doesn't silently mangle international numbers.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function formatDisplay(e164: string): string {
  if (!e164) return '';
  if (!e164.startsWith('+')) return e164;
  // North-American: +1XXXXXXXXXX → (XXX) XXX-XXXX.
  if (e164.startsWith('+1') && e164.length === 12) {
    const d = e164.slice(2);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return e164;
}
