'use client';

/**
 * Address typeahead input. Renders an <input> + a dropdown of Mapbox-
 * autocomplete suggestions. Debounces requests by 250ms so a fast typist
 * doesn't generate a request per keystroke.
 *
 * Behavior:
 *   - User types the address, dropdown shows ranked matches as they type
 *   - User clicks a suggestion or presses Enter on a highlighted row →
 *     onPick fires with the full structured AddressSuggestion (incl. lat/lng)
 *   - User keeps typing past 3 chars without picking → still works, the
 *     parent reads `value` and falls back to a forward-geocode if needed
 *   - Component is fully controlled — parent owns `value`
 *
 * Props mirror a standard <input> minus `type` (always text). Passes through
 * className, placeholder, onBlur, etc.
 */
import { Input } from '@/components/ui/input';
import { type AddressSuggestion, type LatLng, searchAddresses } from '@/lib/geocoding';
import { type JSX, useEffect, useRef, useState } from 'react';

interface Props {
  /** Mapbox token. Pass null to disable autocomplete entirely. */
  mapboxToken: string | null;
  /** Optional proximity bias — usually the tenant's primary yard lat/lng. */
  proximity?: LatLng;
  /** Current input value. */
  value: string;
  /** Called as the user types. */
  onChange: (next: string) => void;
  /**
   * Fired when the user selects a suggestion. The parent should set its
   * value to suggestion.fullAddress and capture lat/lng for downstream use.
   */
  onPick: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

export function AddressAutocompleteInput({
  mapboxToken,
  proximity,
  value,
  onChange,
  onPick,
  placeholder,
  className,
  id,
  ariaLabel,
}: Props): JSX.Element {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced fetch on value change.
  useEffect(() => {
    if (!mapboxToken) {
      setSuggestions([]);
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      const opts: { limit: number; signal: AbortSignal; proximity?: LatLng } = {
        limit: 6,
        signal: abortRef.current.signal,
      };
      if (proximity) opts.proximity = proximity;
      void searchAddresses(trimmed, mapboxToken, opts).then((next) => {
        setSuggestions(next);
        setHighlight(0);
        if (next.length > 0) setOpen(true);
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, mapboxToken, proximity]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      const pick = suggestions[highlight];
      if (pick) {
        e.preventDefault();
        onPick(pick);
        onChange(pick.fullAddress);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <Input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={handleKey}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {open && suggestions.length > 0 ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-auto rounded-md border border-divider bg-bg-surface shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.mapboxId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(s);
                onChange(s.fullAddress);
                setOpen(false);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlight ? 'bg-bg-surface-elevated' : ''
              }`}
            >
              <span className="block font-medium">{s.placeName}</span>
              {s.context ? (
                <span className="block text-[11px] text-text-secondary-on-dark">{s.context}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
