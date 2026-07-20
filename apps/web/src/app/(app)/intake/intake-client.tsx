'use client';

import { AddressAutocompleteInput } from '@/components/ui/address-autocomplete-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type LatLng,
  formatMiles,
  geocodeAddress,
  haversineMiles,
  isUsableMapboxToken,
} from '@/lib/geocoding';
import { cn } from '@/lib/utils';
import { COMMON_MAKES, STANDARD_COLORS, modelsForMake } from './vehicle-options';
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Three-column call intake.
 *
 *   LEFT   — Customer (phone, name, email). Phone autocomplete fires off
 *            /api/customers/search; an exact-phone hit shows an "Existing
 *            customer" badge so the dispatcher knows they're not creating
 *            a duplicate.
 *
 *   CENTER — Vehicle (plate+state, VIN, year/make/model, color, special
 *            instructions). Plate+state autocomplete via /api/vehicles/lookup.
 *            Existing-vehicle badge identical to the customer one.
 *
 *   RIGHT  — Job (service type, pickup, dropoff, authorized by, live rate
 *            quote, notes, DISPATCH).
 *
 * Tab order matches the spec: phone → name → email → plate → state → vin →
 *   year/make/model/color → special → service → pickup → dropoff →
 *   authorized → notes → DISPATCH.
 *
 * The rate-quote panel debounces inputs at 300ms and POSTs to
 * /api/jobs/quote-preview. While the quote is loading we keep the prior
 * total visible and tag a "stale" indicator so the dispatcher isn't staring
 * at a flicker.
 *
 * On DISPATCH success, route to /dispatch (placeholder until Session 5)
 * with a flash query param the destination renders as a toast.
 */
import {
  type Drivetrain,
  type JobAuthorizedBy,
  type JobServiceType,
  type RateQuote,
  drivetrainValues,
  jobAuthorizedByValues,
  jobServiceTypeValues,
} from '@ustowdispatch/shared';
import { CheckCircle2, MapPin, PhoneCall, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  type ChangeEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface VehicleClassOption {
  value:
    | 'light_duty'
    | 'medium_duty'
    | 'heavy_duty'
    | 'motorcycle'
    | 'commercial'
    | 'rv'
    | 'unknown';
  label: string;
}

const VEHICLE_CLASSES: VehicleClassOption[] = [
  { value: 'light_duty', label: 'Light-duty' },
  { value: 'medium_duty', label: 'Medium-duty' },
  { value: 'heavy_duty', label: 'Heavy-duty' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'rv', label: 'RV' },
  { value: 'unknown', label: 'Unknown' },
];

const SERVICE_TYPE_LABELS: Record<JobServiceType, string> = {
  tow: 'Tow',
  jump_start: 'Jump start',
  lockout: 'Lockout',
  tire_change: 'Tire change',
  fuel: 'Fuel delivery',
  winch: 'Winch',
  recovery: 'Recovery',
  impound: 'Impound',
  repo: 'Repossession',
  other: 'Other',
};

const AUTHORIZED_BY_LABELS: Record<JobAuthorizedBy, string> = {
  customer: 'Customer',
  account_contact: 'Account contact',
  motor_club: 'Motor club',
  police: 'Police',
  other: 'Other',
};

interface FormState {
  // customer
  phone: string;
  customerName: string;
  customerEmail: string;
  // additional contact info (Session 4 cleanup — surfaced in collapsible panel)
  homeAddressStreet: string;
  homeAddressCity: string;
  homeAddressState: string;
  homeAddressZip: string;
  secondaryContactName: string;
  secondaryContactPhone: string;
  conviniAppDownloaded: boolean;
  // vehicle
  plate: string;
  plateState: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  color: string;
  vehicleClass: VehicleClassOption['value'];
  drivetrain: Drivetrain | '';
  specialInstructions: string;
  // job
  serviceType: JobServiceType;
  pickupAddress: string;
  pickupLat: string;
  pickupLng: string;
  dropoffAddress: string;
  dropoffLat: string;
  dropoffLng: string;
  authorizedBy: JobAuthorizedBy;
  authorizedByName: string;
  notes: string;
  skipCustomerSms: boolean;
}

const EMPTY: FormState = {
  phone: '',
  customerName: '',
  customerEmail: '',
  homeAddressStreet: '',
  homeAddressCity: '',
  homeAddressState: '',
  homeAddressZip: '',
  secondaryContactName: '',
  secondaryContactPhone: '',
  conviniAppDownloaded: false,
  plate: '',
  plateState: '',
  vin: '',
  year: '',
  make: '',
  model: '',
  color: '',
  vehicleClass: 'light_duty',
  drivetrain: '',
  specialInstructions: '',
  serviceType: 'tow',
  pickupAddress: '',
  pickupLat: '',
  pickupLng: '',
  dropoffAddress: '',
  dropoffLat: '',
  dropoffLng: '',
  authorizedBy: 'customer',
  authorizedByName: '',
  notes: '',
  skipCustomerSms: false,
};

interface StatePickerOption {
  value: string;
  label: string;
  group: 'priority' | 'other';
}

interface IntakeClientProps {
  /** Tenant's office address, joined to a single line. null when company
   *  profile hasn't been filled out yet — distance hints just stay hidden. */
  officeAddress: string | null;
  /** NEXT_PUBLIC_MAPBOX_TOKEN, or null if missing / still on the placeholder. */
  mapboxToken: string | null;
  /** US states pre-sorted with the tenant's home + secondary states first. */
  stateOptions: StatePickerOption[];
}

export function IntakeClient({
  officeAddress,
  mapboxToken,
  stateOptions,
}: IntakeClientProps): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Geocoded office origin — resolved once on mount. Stays null if either
  // the tenant has no physical address yet or geocoding fails.
  const [officeCoord, setOfficeCoord] = useState<LatLng | null>(null);
  const geocodingEnabled = isUsableMapboxToken(mapboxToken);

  // Existing-record detection. We only care about the simplest hit: when a
  // phone or plate exactly matches a record this tenant already has.
  const [existingCustomerName, setExistingCustomerName] = useState<string | null>(null);
  const [existingVehicleSummary, setExistingVehicleSummary] = useState<string | null>(null);

  // Live rate quote.
  const [quote, setQuote] = useState<RateQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  /**
   * Dispatcher-edited override. Once set, takes precedence over the live
   * engine quote — the panel renders this and the intake POST sends it as
   * customQuote so the persisted job mirrors what the customer agreed to.
   * Cleared by the Reset link in the panel.
   */
  const [customQuote, setCustomQuote] = useState<RateQuote | null>(null);
  const [quoteEditorOpen, setQuoteEditorOpen] = useState(false);
  const effectiveQuote = customQuote ?? quote;

  // Has the user typed in the VIN / email fields yet? Used to suppress
  // inline error messages until the dispatcher has had a chance to fill in
  // the field — we still gate DISPATCH on validity from the start.
  const [vinTouched, setVinTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const vinValid = VIN_REGEX.test(form.vin.trim().toUpperCase());
  const emailValid = EMAIL_REGEX.test(form.customerEmail.trim());
  const dispatchDisabled = submitting || !vinValid || !emailValid;

  // -------- existing-customer detection (debounced phone lookup) --------
  useEffect(() => {
    if (!isProbablyPhone(form.phone)) {
      setExistingCustomerName(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        const e164 = toE164(form.phone);
        if (!e164) {
          setExistingCustomerName(null);
          return;
        }
        try {
          const res = await fetch(`/api/customers/search?q=${encodeURIComponent(e164)}&limit=5`, {
            cache: 'no-store',
          });
          if (!res.ok) {
            setExistingCustomerName(null);
            return;
          }
          const matches = (await res.json()) as Array<{
            id: string;
            name: string;
            phone: string | null;
          }>;
          const exact = matches.find((m) => m.phone === e164);
          if (exact) {
            setExistingCustomerName(exact.name);
            setForm((prev) =>
              prev.customerName.trim() === '' ? { ...prev, customerName: exact.name } : prev,
            );
          } else {
            setExistingCustomerName(null);
          }
        } catch {
          setExistingCustomerName(null);
        }
      })();
    }, 350);
    return () => clearTimeout(handle);
  }, [form.phone]);

  // -------- existing-vehicle detection (debounced plate lookup) --------
  useEffect(() => {
    if (form.plate.trim().length < 3 || form.plateState.trim().length !== 2) {
      setExistingVehicleSummary(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/vehicles/lookup?plate=${encodeURIComponent(form.plate.trim())}&state=${encodeURIComponent(form.plateState.trim().toUpperCase())}`,
            { cache: 'no-store' },
          );
          if (res.status === 200) {
            const v = (await res.json()) as {
              id: string;
              year: number | null;
              make: string | null;
              model: string | null;
              color: string | null;
            };
            const summary = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ');
            setExistingVehicleSummary(summary || 'Existing vehicle');
            setForm((prev) => ({
              ...prev,
              year: prev.year || (v.year ? String(v.year) : ''),
              make: prev.make || v.make || '',
              model: prev.model || v.model || '',
              color: prev.color || v.color || '',
            }));
          } else {
            setExistingVehicleSummary(null);
          }
        } catch {
          setExistingVehicleSummary(null);
        }
      })();
    }, 350);
    return () => clearTimeout(handle);
  }, [form.plate, form.plateState]);

  // -------- existing-vehicle detection (debounced VIN lookup) --------
  useEffect(() => {
    const trimmedVin = form.vin.trim().toUpperCase();
    if (!VIN_REGEX.test(trimmedVin)) {
      // Don't clear vehicle summary unless it matches our lookup lifecycle
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/vehicles/lookup?vin=${encodeURIComponent(trimmedVin)}`, {
            cache: 'no-store',
          });
          if (res.status === 200) {
            const v = (await res.json()) as {
              id: string;
              year: number | null;
              make: string | null;
              model: string | null;
              color: string | null;
              plate: string | null;
              plateState: string | null;
              drivetrain: string | null;
              specialInstructions: string | null;
            };
            const summary = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ');
            setExistingVehicleSummary(summary || 'Existing vehicle');
            setForm((prev) => ({
              ...prev,
              year: prev.year || (v.year ? String(v.year) : ''),
              make: prev.make || v.make || '',
              model: prev.model || v.model || '',
              color: prev.color || v.color || '',
              plate: prev.plate || v.plate || '',
              plateState: prev.plateState || v.plateState || '',
              // biome-ignore lint/suspicious/noExplicitAny: bridged event
              drivetrain: prev.drivetrain || (v.drivetrain as any) || '',
              specialInstructions: prev.specialInstructions || v.specialInstructions || '',
            }));
          }
        } catch {
          // ignore
        }
      })();
    }, 350);
    return () => clearTimeout(handle);
  }, [form.vin]);

  // -------- live rate quote (debounced) --------
  const quoteSignature = useMemo(
    () =>
      JSON.stringify({
        s: form.serviceType,
        c: form.vehicleClass,
        plat: form.pickupLat,
        plng: form.pickupLng,
        dlat: form.dropoffLat,
        dlng: form.dropoffLng,
      }),
    [
      form.serviceType,
      form.vehicleClass,
      form.pickupLat,
      form.pickupLng,
      form.dropoffLat,
      form.dropoffLng,
    ],
  );

  useEffect(() => {
    setQuoteLoading(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const payload = {
            serviceType: form.serviceType,
            vehicleClass: form.vehicleClass,
            pickup: {
              address: form.pickupAddress || 'pending',
              ...optionalCoord(form.pickupLat, form.pickupLng),
            },
            ...(form.dropoffAddress || form.dropoffLat || form.dropoffLng
              ? {
                  dropoff: {
                    address: form.dropoffAddress || 'pending',
                    ...optionalCoord(form.dropoffLat, form.dropoffLng),
                  },
                }
              : {}),
          };
          const res = await fetch('/api/jobs/quote-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store',
          });
          if (res.ok) {
            setQuote((await res.json()) as RateQuote);
          }
        } catch {
          // silently keep last quote
        } finally {
          setQuoteLoading(false);
        }
      })();
    }, 300);
    return () => clearTimeout(handle);
  }, [
    quoteSignature,
    form.serviceType,
    form.vehicleClass,
    form.pickupAddress,
    form.pickupLat,
    form.pickupLng,
    form.dropoffAddress,
    form.dropoffLat,
    form.dropoffLng,
  ]);

  // -------- submit --------
  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;

    const e164 = toE164(form.phone);
    if (!e164) {
      setSubmitError('Phone is required (digits, will be normalized to E.164).');
      return;
    }
    if (!form.customerName.trim()) {
      setSubmitError('Customer name is required.');
      return;
    }
    if (!emailValid) {
      setEmailTouched(true);
      setSubmitError('A valid email is required to dispatch.');
      return;
    }
    if (!vinValid) {
      setVinTouched(true);
      setSubmitError('A valid 17-character VIN is required to dispatch.');
      return;
    }
    if (!form.pickupAddress.trim()) {
      setSubmitError('Pickup address is required.');
      return;
    }
    if (form.serviceType === 'tow' && !form.dropoffAddress.trim()) {
      setSubmitError('Dropoff address is required for tow service.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);

    const homeAddress: Record<string, string> = {};
    if (form.homeAddressStreet.trim()) homeAddress.street = form.homeAddressStreet.trim();
    if (form.homeAddressCity.trim()) homeAddress.city = form.homeAddressCity.trim();
    if (form.homeAddressState.trim())
      homeAddress.state = form.homeAddressState.trim().toUpperCase();
    if (form.homeAddressZip.trim()) homeAddress.zip = form.homeAddressZip.trim();
    const secondaryPhone = form.secondaryContactPhone.trim()
      ? toE164(form.secondaryContactPhone)
      : null;

    const payload = {
      customer: {
        name: form.customerName.trim(),
        phone: e164,
        email: form.customerEmail.trim(),
        ...(Object.keys(homeAddress).length ? { homeAddress } : {}),
        ...(form.secondaryContactName.trim()
          ? { secondaryContactName: form.secondaryContactName.trim() }
          : {}),
        ...(secondaryPhone ? { secondaryContactPhone: secondaryPhone } : {}),
        ...(form.conviniAppDownloaded ? { conviniAppDownloaded: true } : {}),
      },
      vehicle: {
        vin: form.vin.trim().toUpperCase(),
        ...(form.plate.trim() ? { plate: form.plate.trim() } : {}),
        ...(form.plateState.trim() ? { plateState: form.plateState.trim().toUpperCase() } : {}),
        ...(form.year ? { year: Number(form.year) } : {}),
        ...(form.make.trim() ? { make: form.make.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
        ...(form.color.trim() ? { color: form.color.trim() } : {}),
        vehicleClass: form.vehicleClass,
        ...(form.drivetrain ? { drivetrain: form.drivetrain } : {}),
        ...(form.specialInstructions.trim()
          ? { specialInstructions: form.specialInstructions.trim() }
          : {}),
      },
      serviceType: form.serviceType,
      pickup: {
        address: form.pickupAddress.trim(),
        ...optionalCoord(form.pickupLat, form.pickupLng),
      },
      ...(form.dropoffAddress.trim() || (form.dropoffLat.trim() && form.dropoffLng.trim())
        ? {
            dropoff: {
              address: form.dropoffAddress.trim() || 'pending',
              ...optionalCoord(form.dropoffLat, form.dropoffLng),
            },
          }
        : {}),
      authorizedBy: form.authorizedBy,
      ...(form.authorizedByName.trim() ? { authorizedByName: form.authorizedByName.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      ...(form.skipCustomerSms ? { skipCustomerSms: true } : {}),
      ...(customQuote ? { customQuote } : {}),
    };

    try {
      const res = await fetch('/api/jobs/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setSubmitError(data?.message ?? 'Could not create the job. Please try again.');
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as { job: { jobNumber: string } };
      const jobNumber = data.job.jobNumber;
      // Tracking SMS is dispatched server-side on the DISPATCHED transition,
      // not at intake. Surface a hint in the toast so dispatchers know to
      // expect the badge once they assign the job.
      const smsParam = form.skipCustomerSms ? '&sms=skipped' : '&sms=pending';
      router.push(`/dispatch?created=${encodeURIComponent(jobNumber)}${smsParam}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      setSubmitError(`Network error: ${reason}`);
      setSubmitting(false);
    }
  }

  function onKeyDownGlobal(e: KeyboardEvent<HTMLFormElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const submitBtn = e.currentTarget.elements.namedItem(
        'dispatch-submit',
      ) as HTMLButtonElement | null;
      submitBtn?.click();
    }
  }

  // -------- office origin geocode (once) --------
  useEffect(() => {
    if (!geocodingEnabled || !officeAddress || !mapboxToken) return;
    const controller = new AbortController();
    void geocodeAddress(officeAddress, mapboxToken, controller.signal).then((coord) => {
      if (coord) setOfficeCoord(coord);
    });
    return () => controller.abort();
  }, [geocodingEnabled, officeAddress, mapboxToken]);

  // -------- pickup geocode (debounced) --------
  useEffect(() => {
    if (!geocodingEnabled || !mapboxToken) return;
    const query = form.pickupAddress.trim();
    if (query.length < 4) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void geocodeAddress(query, mapboxToken, controller.signal).then((coord) => {
        if (!coord) return;
        // Only overwrite if the dispatcher hasn't typed an explicit override.
        setForm((prev) => {
          if (prev.pickupAddress.trim() !== query) return prev;
          return {
            ...prev,
            pickupLat: coord.lat.toFixed(6),
            pickupLng: coord.lng.toFixed(6),
          };
        });
      });
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [form.pickupAddress, geocodingEnabled, mapboxToken]);

  // -------- dropoff geocode (debounced) --------
  useEffect(() => {
    if (!geocodingEnabled || !mapboxToken) return;
    const query = form.dropoffAddress.trim();
    if (query.length < 4) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void geocodeAddress(query, mapboxToken, controller.signal).then((coord) => {
        if (!coord) return;
        setForm((prev) => {
          if (prev.dropoffAddress.trim() !== query) return prev;
          return {
            ...prev,
            dropoffLat: coord.lat.toFixed(6),
            dropoffLng: coord.lng.toFixed(6),
          };
        });
      });
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [form.dropoffAddress, geocodingEnabled, mapboxToken]);

  // -------- derived distance hints --------
  const pickupCoord = useMemo<LatLng | null>(() => {
    const lat = Number.parseFloat(form.pickupLat);
    const lng = Number.parseFloat(form.pickupLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [form.pickupLat, form.pickupLng]);

  const dropoffCoord = useMemo<LatLng | null>(() => {
    const lat = Number.parseFloat(form.dropoffLat);
    const lng = Number.parseFloat(form.dropoffLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [form.dropoffLat, form.dropoffLng]);

  const officeToPickupMiles =
    officeCoord && pickupCoord ? haversineMiles(officeCoord, pickupCoord) : null;
  const pickupToDropoffMiles =
    pickupCoord && dropoffCoord ? haversineMiles(pickupCoord, dropoffCoord) : null;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      onKeyDown={onKeyDownGlobal}
      className="space-y-4"
      data-testid="intake-form"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* LEFT — Customer */}
        <Card title="Customer" icon={PhoneCall}>
          <Field label="Phone">
            <Input
              autoFocus
              tabIndex={0}
              data-testid="intake-phone"
              placeholder="555-555-0100"
              value={form.phone}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update('phone', e.target.value)}
              onBlur={(e: ChangeEvent<HTMLInputElement>) =>
                update('phone', formatPhoneOnBlur(e.target.value))
              }
              autoComplete="tel"
              inputMode="tel"
            />
            {existingCustomerName ? (
              <Badge>Existing customer - {existingCustomerName}</Badge>
            ) : null}
          </Field>
          <Field label="Name">
            <Input
              tabIndex={0}
              data-testid="intake-customer-name"
              placeholder="Customer name"
              value={form.customerName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('customerName', e.target.value)
              }
              autoComplete="name"
            />
          </Field>
          <Field label="Email" required>
            <Input
              tabIndex={0}
              type="email"
              placeholder="customer@example.com"
              data-testid="intake-customer-email"
              value={form.customerEmail}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('customerEmail', e.target.value)
              }
              onBlur={() => setEmailTouched(true)}
              aria-invalid={emailTouched && !emailValid}
              aria-describedby="intake-email-error"
              autoComplete="email"
            />
            {emailTouched && !emailValid ? (
              <p
                id="intake-email-error"
                data-testid="intake-email-error"
                className="text-xs text-danger"
              >
                Email is required to dispatch — needed for receipts and the Convini app invite.
              </p>
            ) : null}
          </Field>
          <AdditionalContactInfo form={form} update={update} />
        </Card>

        {/* CENTER — Vehicle */}
        <Card title="Vehicle" icon={Truck}>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Plate</Label>
              <Input
                tabIndex={0}
                data-testid="intake-plate"
                placeholder="Plate"
                value={form.plate}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update('plate', e.target.value.toUpperCase())
                }
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <select
                tabIndex={0}
                data-testid="intake-plate-state"
                value={form.plateState}
                onChange={(e) => update('plateState', e.target.value)}
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark focus-visible:border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
              >
                <option value="">—</option>
                {(() => {
                  const priority = stateOptions.filter((s) => s.group === 'priority');
                  const other = stateOptions.filter((s) => s.group === 'other');
                  return (
                    <>
                      {priority.length > 0 ? (
                        <optgroup label="Home & nearby">
                          {priority.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <optgroup label="All states">
                        {other.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  );
                })()}
              </select>
            </div>
          </div>
          {existingVehicleSummary ? (
            <Badge>Existing vehicle - {existingVehicleSummary}</Badge>
          ) : null}
          <Field label="VIN" required>
            <Input
              tabIndex={0}
              placeholder="17 characters, A-Z (no I/O/Q) and digits"
              maxLength={17}
              value={form.vin}
              data-testid="intake-vin"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('vin', e.target.value.toUpperCase())
              }
              onBlur={() => setVinTouched(true)}
              aria-invalid={vinTouched && !vinValid}
              aria-describedby="intake-vin-error"
              autoComplete="off"
            />
            {vinTouched && !vinValid ? (
              <p
                id="intake-vin-error"
                data-testid="intake-vin-error"
                className="text-xs text-danger"
              >
                {form.vin.trim().length === 0
                  ? 'VIN is required.'
                  : 'VIN must be 17 characters: uppercase A–Z (no I/O/Q) and digits only.'}
              </p>
            ) : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year">
              <Input
                tabIndex={0}
                type="number"
                inputMode="numeric"
                placeholder="2018"
                value={form.year}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('year', e.target.value)}
              />
            </Field>
            <Field label="Color">
              <select
                tabIndex={0}
                data-testid="intake-color"
                value={form.color}
                onChange={(e) => update('color', e.target.value)}
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
              >
                <option value="">Select color…</option>
                {STANDARD_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Make">
              <Input
                tabIndex={0}
                placeholder="Honda"
                list="intake-make-options"
                data-testid="intake-make"
                value={form.make}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const next = e.target.value;
                  // Changing make invalidates the currently-selected model so
                  // the dispatcher doesn't ship a Honda Camry by accident.
                  setForm((prev) => ({
                    ...prev,
                    make: next,
                    model: prev.make === next ? prev.model : '',
                  }));
                }}
              />
              <datalist id="intake-make-options">
                {COMMON_MAKES.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Model">
              <Input
                tabIndex={0}
                placeholder="Civic"
                list="intake-model-options"
                data-testid="intake-model"
                value={form.model}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('model', e.target.value)}
              />
              <datalist id="intake-model-options">
                {modelsForMake(form.make).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class">
              <select
                tabIndex={0}
                value={form.vehicleClass}
                onChange={(e) =>
                  update('vehicleClass', e.target.value as FormState['vehicleClass'])
                }
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
              >
                {VEHICLE_CLASSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                tabIndex={0}
                data-testid="intake-drivetrain"
                value={form.drivetrain}
                onChange={(e) => update('drivetrain', e.target.value as FormState['drivetrain'])}
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
              >
                <option value="">Select…</option>
                {drivetrainValues.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Special instructions">
            <textarea
              tabIndex={0}
              value={form.specialInstructions}
              onChange={(e) => update('specialInstructions', e.target.value)}
              rows={2}
              className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark"
              placeholder="Low clearance, all-wheel-drive, etc."
            />
          </Field>
        </Card>

        {/* RIGHT — Job */}
        <Card title="Job" icon={MapPin}>
          <Field label="Service type">
            <div className="grid grid-cols-3 gap-2">
              {jobServiceTypeValues.map((svc, idx) => (
                <button
                  key={svc}
                  type="button"
                  tabIndex={13 + idx}
                  data-testid={`intake-service-${svc}`}
                  onClick={() => update('serviceType', svc)}
                  className={cn(
                    'rounded-[10px] border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition-colors',
                    form.serviceType === svc
                      ? 'border-brand-primary bg-brand-primary/15 text-brand-primary'
                      : 'border-divider text-text-secondary-on-dark hover:bg-bg-surface-elevated',
                  )}
                >
                  {SERVICE_TYPE_LABELS[svc]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Pickup">
            <AddressAutocompleteInput
              mapboxToken={mapboxToken}
              value={form.pickupAddress}
              onChange={(next) => update('pickupAddress', next)}
              onPick={(s) => {
                update('pickupAddress', s.fullAddress);
                update('pickupLat', String(s.lat));
                update('pickupLng', String(s.lng));
              }}
              placeholder="Address or landmark"
              ariaLabel="Pickup address"
            />
            <DistanceHint
              data-testid="intake-pickup-distance"
              enabled={geocodingEnabled}
              originLabel="office"
              miles={officeToPickupMiles}
              originMissing={!officeAddress}
              addressFilled={form.pickupAddress.trim().length >= 4}
              originUnresolved={!!officeAddress && officeCoord === null}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                tabIndex={0}
                placeholder="Lat"
                inputMode="decimal"
                value={form.pickupLat}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('pickupLat', e.target.value)}
              />
              <Input
                tabIndex={0}
                placeholder="Lng"
                inputMode="decimal"
                value={form.pickupLng}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('pickupLng', e.target.value)}
              />
            </div>
          </Field>

          {form.serviceType === 'tow' ||
          form.serviceType === 'impound' ||
          form.serviceType === 'recovery' ? (
            <Field label="Dropoff">
              <AddressAutocompleteInput
                mapboxToken={mapboxToken}
                value={form.dropoffAddress}
                onChange={(next) => update('dropoffAddress', next)}
                onPick={(s) => {
                  update('dropoffAddress', s.fullAddress);
                  update('dropoffLat', String(s.lat));
                  update('dropoffLng', String(s.lng));
                }}
                placeholder="Where the vehicle is going"
                ariaLabel="Dropoff address"
              />
              <DistanceHint
                data-testid="intake-dropoff-distance"
                enabled={geocodingEnabled}
                originLabel="pickup"
                miles={pickupToDropoffMiles}
                originMissing={pickupCoord === null}
                addressFilled={form.dropoffAddress.trim().length >= 4}
                originUnresolved={false}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  tabIndex={0}
                  placeholder="Lat"
                  inputMode="decimal"
                  value={form.dropoffLat}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    update('dropoffLat', e.target.value)
                  }
                />
                <Input
                  tabIndex={0}
                  placeholder="Lng"
                  inputMode="decimal"
                  value={form.dropoffLng}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    update('dropoffLng', e.target.value)
                  }
                />
              </div>
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Authorized by">
              <select
                tabIndex={0}
                value={form.authorizedBy}
                onChange={(e) => update('authorizedBy', e.target.value as JobAuthorizedBy)}
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
              >
                {jobAuthorizedByValues.map((v) => (
                  <option key={v} value={v}>
                    {AUTHORIZED_BY_LABELS[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Authorized name">
              <Input
                tabIndex={0}
                placeholder="Optional"
                value={form.authorizedByName}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update('authorizedByName', e.target.value)
                }
              />
            </Field>
          </div>

          <RateQuotePanel
            quote={effectiveQuote}
            loading={quoteLoading}
            customized={!!customQuote}
            onOpenEditor={() => setQuoteEditorOpen(true)}
            onReset={() => setCustomQuote(null)}
          />
          {quoteEditorOpen ? (
            <InvoiceEditorDialog
              initial={customQuote ?? quote}
              onCancel={() => setQuoteEditorOpen(false)}
              onApply={(edited) => {
                setCustomQuote(edited);
                setQuoteEditorOpen(false);
              }}
            />
          ) : null}

          <Field label="Notes">
            <textarea
              tabIndex={0}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={2}
              className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark"
              placeholder="Anything the driver needs to know"
            />
          </Field>

          <label className="flex items-start gap-2 text-xs text-text-secondary-on-dark">
            <input
              type="checkbox"
              checked={form.skipCustomerSms}
              onChange={(e) => update('skipCustomerSms', e.target.checked)}
              data-testid="skip-customer-sms"
              className="mt-0.5"
            />
            <span>
              Skip customer SMS (e.g. fleet/account customer manages their own comms). Dispatcher
              can still resend manually from the board.
            </span>
          </label>

          {submitError ? (
            <div className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {submitError}
            </div>
          ) : null}

          <Button
            type="submit"
            name="dispatch-submit"
            tabIndex={0}
            disabled={dispatchDisabled}
            data-testid="intake-dispatch"
            aria-disabled={dispatchDisabled}
            className="w-full"
            size="lg"
          >
            {submitting ? 'Dispatching…' : 'Dispatch'}
          </Button>
        </Card>
      </div>
    </form>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof PhoneCall;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-4 rounded-[14px] border border-divider bg-bg-surface p-5">
      <header className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-primary" />
        <h2 className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          {title}
        </h2>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  let enhanced: React.ReactNode = children;
  if (React.isValidElement(children)) {
    const existing = children.props as Record<string, unknown> | undefined;
    const extra: Record<string, string | boolean> = {};
    if (!existing?.id) extra.id = id;
    if (required) extra['aria-required'] = true;
    enhanced = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, extra);
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span
            aria-label="required"
            className="ml-0.5 text-danger"
            data-testid={`intake-required-${label.toLowerCase()}`}
          >
            *
          </span>
        ) : null}
      </Label>
      {enhanced}
    </div>
  );
}

/**
 * Inline hint rendered just below an address input that shows the haversine
 * distance from a known origin once both coordinates are resolved. Stays
 * silent (renders nothing) unless we have something useful to say — empty
 * field, geocoding disabled, or origin missing all collapse the slot so it
 * doesn't take vertical space.
 */
function DistanceHint({
  enabled,
  originLabel,
  miles,
  originMissing,
  addressFilled,
  originUnresolved,
  'data-testid': testId,
}: {
  enabled: boolean;
  originLabel: 'office' | 'pickup';
  miles: number | null;
  /** True when the upstream origin coords aren't available (e.g. no pickup yet). */
  originMissing: boolean;
  /** True when the address text has been typed in (so we can show a "geocoding…" state). */
  addressFilled: boolean;
  /** True when the office address exists but Mapbox hasn't returned coords yet. */
  originUnresolved: boolean;
  'data-testid'?: string;
}): JSX.Element | null {
  if (!enabled) return null;
  if (miles != null) {
    return (
      <p
        data-testid={testId}
        className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark"
      >
        <MapPin className="mr-1 inline h-3 w-3 text-brand-primary" />
        {formatMiles(miles)} from {originLabel}
      </p>
    );
  }
  if (addressFilled && (originUnresolved || (!originMissing && miles === null))) {
    return (
      <p
        data-testid={testId}
        className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60"
      >
        Resolving distance…
      </p>
    );
  }
  return null;
}

function AdditionalContactInfo({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}): JSX.Element {
  return (
    <details
      className="rounded-[10px] border border-divider bg-bg-base/40 px-3 py-2"
      data-testid="intake-additional-contact"
    >
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary-on-dark">
        Additional contact info
      </summary>
      <div className="mt-3 space-y-3">
        <Field label="Home address — street">
          <Input
            data-testid="intake-home-street"
            value={form.homeAddressStreet}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              update('homeAddressStreet', e.target.value)
            }
            placeholder="123 Main St"
            autoComplete="street-address"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <Input
              data-testid="intake-home-city"
              value={form.homeAddressCity}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('homeAddressCity', e.target.value)
              }
              placeholder="Columbus"
              autoComplete="address-level2"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="State">
              <Input
                data-testid="intake-home-state"
                value={form.homeAddressState}
                maxLength={2}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update('homeAddressState', e.target.value.toUpperCase())
                }
                placeholder="OH"
                autoComplete="address-level1"
              />
            </Field>
            <Field label="ZIP">
              <Input
                data-testid="intake-home-zip"
                value={form.homeAddressZip}
                maxLength={20}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update('homeAddressZip', e.target.value)
                }
                placeholder="43215"
                autoComplete="postal-code"
              />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Secondary contact name">
            <Input
              data-testid="intake-secondary-name"
              value={form.secondaryContactName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('secondaryContactName', e.target.value)
              }
              placeholder="Spouse, shop manager, etc."
              autoComplete="off"
            />
          </Field>
          <Field label="Secondary contact phone">
            <Input
              data-testid="intake-secondary-phone"
              value={form.secondaryContactPhone}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('secondaryContactPhone', e.target.value)
              }
              onBlur={(e: ChangeEvent<HTMLInputElement>) =>
                update('secondaryContactPhone', formatPhoneOnBlur(e.target.value))
              }
              placeholder="555-555-0102"
              autoComplete="off"
              inputMode="tel"
            />
          </Field>
        </div>
        <label className="mt-1 inline-flex cursor-pointer items-center gap-2 text-xs text-text-secondary-on-dark">
          <input
            type="checkbox"
            data-testid="intake-convini-app"
            checked={form.conviniAppDownloaded}
            onChange={(e) => update('conviniAppDownloaded', e.target.checked)}
            className="h-4 w-4 rounded border-divider bg-bg-surface"
          />
          Customer has the Convini app installed
        </label>
      </div>
    </details>
  );
}

function Badge({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="mt-1 inline-flex items-center gap-1 rounded-[8px] border border-ok/30 bg-ok/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ok">
      <CheckCircle2 className="h-3 w-3" />
      {children}
    </p>
  );
}

function RateQuotePanel({
  quote,
  loading,
  customized,
  onOpenEditor,
  onReset,
}: {
  quote: RateQuote | null;
  loading: boolean;
  customized: boolean;
  /** Open the invoice editor dialog. Disabled while no quote exists. */
  onOpenEditor: () => void;
  /** Drop the dispatcher-edited override and fall back to the engine quote. */
  onReset: () => void;
}): JSX.Element {
  const clickable = quote !== null;
  return (
    <div
      data-testid="intake-rate-quote"
      className={cn(
        'rounded-[12px] border bg-bg-base/60 p-3 transition-colors',
        customized ? 'border-brand-primary/70 ring-1 ring-brand-primary/30' : 'border-divider',
        clickable ? 'cursor-pointer hover:border-brand-primary/60 hover:bg-bg-base/80' : '',
      )}
      onClick={clickable ? onOpenEditor : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenEditor();
        }
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? 'Open invoice editor' : undefined}
    >
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          {customized ? 'Final quote (edited)' : 'Live quote'}
          {customized ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="rounded bg-brand-primary/15 px-1.5 py-0.5 text-[9px] text-brand-primary hover:bg-brand-primary/25"
            >
              Reset
            </button>
          ) : null}
        </span>
        <span
          className={cn(
            'font-condensed text-2xl font-extrabold',
            loading ? 'text-text-secondary-on-dark-on-dark/60' : 'text-brand-primary',
          )}
          data-testid="intake-rate-total"
        >
          {quote ? formatCents(quote.totalCents) : '$0.00'}
        </span>
      </div>
      {quote ? (
        <ul className="mt-2 space-y-1 text-xs text-text-secondary-on-dark">
          {quote.lineItems.map((li) => (
            <li key={li.code} className="flex justify-between">
              <span>{li.label}</span>
              <span className="font-mono">{formatCents(li.amountCents)}</span>
            </li>
          ))}
          {quote.lineItems.length === 0 ? (
            <li className="text-text-secondary-on-dark-on-dark/60">No line items.</li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-text-secondary-on-dark-on-dark/60">
          Enter the service and pickup to see the calculated price.
        </p>
      )}
      {quote ? (
        <p className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
          <span>
            Source: {quote.source} - {quote.distanceMiles.toFixed(2)} mi
          </span>
          <span className="text-brand-primary">Click to edit →</span>
        </p>
      ) : null}
    </div>
  );
}

interface EditableLineItem {
  /** Stable React key (also persisted as code when not blank). */
  id: string;
  code: string;
  label: string;
  amountCents: number;
  unit?: string;
  quantity?: number;
}

function InvoiceEditorDialog({
  initial,
  onApply,
  onCancel,
}: {
  initial: RateQuote | null;
  onApply: (quote: RateQuote) => void;
  onCancel: () => void;
}): JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  React.useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const [rows, setRows] = useState<EditableLineItem[]>(() => {
    if (!initial) return [];
    return initial.lineItems.map((li, i) => ({
      id: `${li.code}-${i}`,
      code: li.code,
      label: li.label,
      amountCents: li.amountCents,
      ...(li.unit !== undefined ? { unit: li.unit } : {}),
      ...(li.quantity !== undefined ? { quantity: li.quantity } : {}),
    }));
  });

  const subtotalCents = rows.reduce(
    (sum, r) => sum + (Number.isFinite(r.amountCents) ? r.amountCents : 0),
    0,
  );

  function updateRow(id: string, patch: Partial<EditableLineItem>): void {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string): void {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }
  function addRow(): void {
    const id = `custom-${Date.now()}`;
    setRows((prev) => [...prev, { id, code: id, label: '', amountCents: 0 }]);
  }

  function apply(): void {
    if (!initial) return;
    const lineItems = rows
      .filter((r) => r.label.trim().length > 0)
      .map((r) => ({
        code: r.code.trim() || r.id,
        label: r.label.trim(),
        amountCents: Math.round(r.amountCents),
        ...(r.unit !== undefined ? { unit: r.unit } : {}),
        ...(r.quantity !== undefined ? { quantity: r.quantity } : {}),
      }));
    const subtotal = lineItems.reduce((sum, li) => sum + li.amountCents, 0);
    const out: RateQuote = {
      ...initial,
      lineItems,
      subtotalCents: subtotal,
      totalCents: subtotal,
      calculationTrace: [
        ...(initial.calculationTrace ?? []),
        `Dispatcher edited quote on intake; ${rows.length} line item(s).`,
      ],
    };
    onApply(out);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="invoice-editor-title"
      onClose={onCancel}
      className="w-full max-w-2xl rounded-[14px] border border-divider bg-bg-surface p-0 text-text-primary-on-dark shadow-xl backdrop:bg-bg-base/60 backdrop:backdrop-blur"
    >
      <div className="p-5">
        <header className="flex items-start justify-between">
          <div>
            <h2
              id="invoice-editor-title"
              className="font-condensed text-lg font-extrabold uppercase"
            >
              Edit quote
            </h2>
            <p className="mt-1 text-xs text-text-secondary-on-dark">
              Adjust line items, then apply. The customized total ships with this job and is what
              you'll quote the customer.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-text-secondary-on-dark hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          >
            ✕
          </button>
        </header>

        <div className="mt-4 overflow-hidden rounded-[10px] border border-divider">
          <table className="w-full text-sm">
            <thead className="bg-bg-surface/60 text-left">
              <tr className="text-[10px] uppercase tracking-wider text-text-secondary-on-dark">
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <Input
                      value={r.label}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateRow(r.id, { label: e.target.value })
                      }
                      placeholder="Service or fee"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      value={(r.amountCents / 100).toFixed(2)}
                      inputMode="decimal"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const n = Number.parseFloat(e.target.value);
                        const cents = Number.isFinite(n) ? Math.round(n * 100) : 0;
                        updateRow(r.id, { amountCents: cents });
                      }}
                      className="text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      aria-label={`Remove ${r.label || 'row'}`}
                      className="rounded-md p-1 text-danger transition-colors hover:bg-danger/10"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-6 text-center text-xs text-text-secondary-on-dark"
                  >
                    No line items. Click <strong>Add line</strong> below.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={addRow}
            className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-bg-surface-elevated"
          >
            + Add line
          </button>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
              Total
            </p>
            <p className="font-condensed text-2xl font-extrabold text-brand-primary">
              {formatCents(subtotalCents)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary-on-dark hover:text-text-primary-on-dark"
          >
            Cancel
          </button>
          <Button type="button" onClick={apply} disabled={!initial}>
            Apply as final quote
          </Button>
        </div>
      </div>
    </dialog>
  );
}

// ----- helpers -----
function isProbablyPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7;
}

function toE164(s: string): string | null {
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Normalize anything the dispatcher typed into a US-style XXX-XXX-XXXX
 * phone number on blur. Strips every non-digit and:
 *   - 10 digits         → "XXX-XXX-XXXX"
 *   - 11 digits, leading "1" → drops the 1, then "XXX-XXX-XXXX"
 *   - anything else     → leaves the input alone (toE164 handles the
 *                          looser inputs at submit time)
 *
 * Live formatting on every keystroke was rejected because it fights
 * paste / select-and-replace flows; on-blur is the cleanest UX.
 */
function formatPhoneOnBlur(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function optionalCoord(lat: string, lng: string): { lat?: number; lng?: number } {
  const out: { lat?: number; lng?: number } = {};
  const la = Number.parseFloat(lat);
  const ln = Number.parseFloat(lng);
  if (Number.isFinite(la)) out.lat = la;
  if (Number.isFinite(ln)) out.lng = ln;
  return out;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
