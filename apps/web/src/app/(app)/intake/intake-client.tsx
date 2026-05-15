'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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
  type JobAuthorizedBy,
  type JobServiceType,
  type RateQuote,
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

export function IntakeClient(): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Existing-record detection. We only care about the simplest hit: when a
  // phone or plate exactly matches a record this tenant already has.
  const [existingCustomerName, setExistingCustomerName] = useState<string | null>(null);
  const [existingVehicleSummary, setExistingVehicleSummary] = useState<string | null>(null);

  // Live rate quote.
  const [quote, setQuote] = useState<RateQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

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

  // -------- geolocation helper for the pickup field --------
  async function fillPickupFromGeolocation(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          update('pickupLat', pos.coords.latitude.toFixed(6));
          update('pickupLng', pos.coords.longitude.toFixed(6));
          resolve();
        },
        () => resolve(),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
      );
    });
  }

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
              autoComplete="tel"
            />
            {existingCustomerName ? (
              <Badge>Existing customer · {existingCustomerName}</Badge>
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
              <Input
                tabIndex={0}
                placeholder="OH"
                maxLength={2}
                value={form.plateState}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update('plateState', e.target.value.toUpperCase())
                }
                autoComplete="off"
              />
            </div>
          </div>
          {existingVehicleSummary ? (
            <Badge>Existing vehicle · {existingVehicleSummary}</Badge>
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
              <Input
                tabIndex={0}
                placeholder="Blue"
                value={form.color}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('color', e.target.value)}
              />
            </Field>
            <Field label="Make">
              <Input
                tabIndex={0}
                placeholder="Honda"
                value={form.make}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('make', e.target.value)}
              />
            </Field>
            <Field label="Model">
              <Input
                tabIndex={0}
                placeholder="Civic"
                value={form.model}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update('model', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Class">
            <select
              tabIndex={0}
              value={form.vehicleClass}
              onChange={(e) => update('vehicleClass', e.target.value as FormState['vehicleClass'])}
              className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
            >
              {VEHICLE_CLASSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
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
            <Input
              tabIndex={0}
              data-testid="intake-pickup-address"
              placeholder="Address or landmark"
              value={form.pickupAddress}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update('pickupAddress', e.target.value)
              }
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
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
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void fillPickupFromGeolocation()}
              >
                Use my location
              </Button>
            </div>
          </Field>

          {form.serviceType === 'tow' ||
          form.serviceType === 'impound' ||
          form.serviceType === 'recovery' ? (
            <Field label="Dropoff">
              <Input
                tabIndex={0}
                data-testid="intake-dropoff-address"
                placeholder="Where the vehicle is going"
                value={form.dropoffAddress}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update('dropoffAddress', e.target.value)
                }
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

          <RateQuotePanel quote={quote} loading={quoteLoading} />

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
              placeholder="555-555-0102"
              autoComplete="off"
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
}: {
  quote: RateQuote | null;
  loading: boolean;
}): JSX.Element {
  return (
    <div
      data-testid="intake-rate-quote"
      className="rounded-[12px] border border-divider bg-bg-base/60 p-3"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark-on-dark/60">
          Live quote
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
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
          Source: {quote.source} · {quote.distanceMiles.toFixed(2)} mi
        </p>
      ) : null}
    </div>
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
