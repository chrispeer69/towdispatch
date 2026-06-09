'use client';

/**
 * Add / Edit form for a single Service Catalog entry. Rendered as a modal
 * (centered overlay, focus-trapped via the dialog element + Escape handler)
 * so it matches the same dispatcher-friendly idiom used elsewhere in the
 * app — list view stays visible behind a scrim, save/cancel are the only
 * exits.
 *
 * The form derives isQuoted from calculationUnit on save so the wire
 * payload always satisfies the shared Zod refinement; the dispatcher only
 * picks one (the calc unit), is_quoted follows.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  SERVICE_CALCULATION_UNIT_LABELS,
  SERVICE_CATEGORY_LABELS,
  type ServiceCalculationUnit,
  type ServiceCatalogEntryDto,
  type ServiceCategory,
  type VehicleClass,
  serviceCalculationUnitValues,
  serviceCategoryValues,
  vehicleClassValues,
} from '@towdispatch/shared';
import * as React from 'react';
import { useEffect, useState } from 'react';

interface Props {
  mode: 'create' | 'edit';
  initial: ServiceCatalogEntryDto | undefined;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void> | void;
  onClose: () => void;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  category: ServiceCategory;
  calculationUnit: ServiceCalculationUnit;
  applicableVehicleClasses: VehicleClass[];
  defaultCommissionPctOverride: string;
  supportsPerResourceMultiplier: boolean;
  isActive: boolean;
  sortOrder: string;
}

function initialState(entry: ServiceCatalogEntryDto | undefined): FormState {
  return {
    code: entry?.code ?? '',
    name: entry?.name ?? '',
    description: entry?.description ?? '',
    category: entry?.category ?? 'towing',
    calculationUnit: entry?.calculationUnit ?? 'per_call',
    applicableVehicleClasses: entry?.applicableVehicleClasses ?? [],
    defaultCommissionPctOverride: entry?.defaultCommissionPctOverride ?? '',
    supportsPerResourceMultiplier: entry?.supportsPerResourceMultiplier ?? false,
    isActive: entry?.isActive ?? true,
    sortOrder: entry ? String(entry.sortOrder) : '0',
  };
}

export function ServiceCatalogForm({ mode, initial, busy, onSubmit, onClose }: Props): JSX.Element {
  const [state, setState] = useState<FormState>(() => initialState(initial));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleVehicleClass(vc: VehicleClass): void {
    setState((s) => ({
      ...s,
      applicableVehicleClasses: s.applicableVehicleClasses.includes(vc)
        ? s.applicableVehicleClasses.filter((x) => x !== vc)
        : [...s.applicableVehicleClasses, vc],
    }));
  }

  function buildPayload(): Record<string, unknown> {
    const calcUnit = state.calculationUnit;
    const payload: Record<string, unknown> = {
      code: state.code.trim().toUpperCase(),
      name: state.name.trim(),
      category: state.category,
      calculationUnit: calcUnit,
      isQuoted: calcUnit === 'quoted',
      applicableVehicleClasses: state.applicableVehicleClasses,
      supportsPerResourceMultiplier: state.supportsPerResourceMultiplier,
      isActive: state.isActive,
      sortOrder: Number(state.sortOrder) || 0,
    };
    const description = state.description.trim();
    if (description) payload.description = description;
    else if (mode === 'edit') payload.description = null;
    const commission = state.defaultCommissionPctOverride.trim();
    if (commission) payload.defaultCommissionPctOverride = commission;
    else if (mode === 'edit') payload.defaultCommissionPctOverride = null;
    return payload;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!state.code.match(/^[A-Z][A-Z0-9_]*$/)) {
      setError('Code: uppercase letters, digits, and underscores only.');
      return;
    }
    if (!state.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (state.defaultCommissionPctOverride.trim()) {
      const n = Number(state.defaultCommissionPctOverride);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError('Commission override must be between 0 and 100.');
        return;
      }
    }

    await onSubmit(buildPayload());
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: <dialog>.showModal() doesn't fit our React-controlled open state — same pattern as dispatch/tracking-badge.tsx.
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[14px] border border-divider bg-bg-surface p-6 shadow-xl">
        <header className="mb-5 flex items-start justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
              {mode === 'create' ? 'New service' : 'Edit service'}
            </span>
            <h2
              id="service-form-title"
              className="mt-1 font-condensed text-2xl font-extrabold uppercase tracking-tight text-text-primary-on-dark"
            >
              {mode === 'create' ? 'Add to catalog' : initial?.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[8px] p-1.5 text-text-secondary-on-dark hover:bg-bg-surface-elevated hover:text-text-primary-on-dark"
          >
            ✕
          </button>
        </header>

        <form noValidate onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Code" hint="Uppercase + underscores, e.g. TOW_BASE">
              <Input
                value={state.code}
                onChange={(e) => setState((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
                placeholder="TOW_BASE"
                required
              />
            </Field>
            <Field label="Name">
              <Input
                value={state.name}
                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                placeholder="Tow"
                required
                maxLength={100}
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={state.description}
              onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
              rows={2}
              maxLength={1000}
              className="w-full rounded-[10px] border border-divider bg-bg-surface px-3 py-2 text-sm text-text-primary-on-dark"
              placeholder="Optional internal description"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Category">
              <select
                value={state.category}
                onChange={(e) =>
                  setState((s) => ({ ...s, category: e.target.value as ServiceCategory }))
                }
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
              >
                {serviceCategoryValues.map((c) => (
                  <option key={c} value={c}>
                    {SERVICE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Calculation unit">
              <select
                value={state.calculationUnit}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    calculationUnit: e.target.value as ServiceCalculationUnit,
                  }))
                }
                className="h-11 w-full rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
              >
                {serviceCalculationUnitValues.map((c) => (
                  <option key={c} value={c}>
                    {SERVICE_CALCULATION_UNIT_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Applicable vehicle classes"
            hint="Leave empty for class-independent services (Admin Fee, Storage…)."
          >
            <div className="flex flex-wrap gap-2">
              {vehicleClassValues.map((vc) => {
                const selected = state.applicableVehicleClasses.includes(vc);
                return (
                  <button
                    key={vc}
                    type="button"
                    onClick={() => toggleVehicleClass(vc)}
                    className={cn(
                      'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                      selected
                        ? 'border-brand-primary/40 bg-brand-primary/15 text-brand-primary'
                        : 'border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark hover:text-text-primary-on-dark',
                    )}
                  >
                    {vc.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Commission % override" hint="Blank = use driver default">
              <Input
                value={state.defaultCommissionPctOverride}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    defaultCommissionPctOverride: e.target.value,
                  }))
                }
                placeholder="e.g. 25 or blank"
                inputMode="decimal"
              />
            </Field>
            <Field label="Sort order">
              <Input
                value={state.sortOrder}
                onChange={(e) => setState((s) => ({ ...s, sortOrder: e.target.value }))}
                inputMode="numeric"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange"
                checked={state.supportsPerResourceMultiplier}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    supportsPerResourceMultiplier: e.target.checked,
                  }))
                }
              />
              <span>Per-resource multiplier (e.g. per-hour-per-man)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary-on-dark">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange"
                checked={state.isActive}
                onChange={(e) => setState((s) => ({ ...s, isActive: e.target.checked }))}
              />
              <span>Active</span>
            </label>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create service' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  let enhanced: React.ReactNode = children;
  if (React.isValidElement(children)) {
    enhanced = React.cloneElement(children as React.ReactElement<{ id?: string }>, { id });
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {enhanced}
      {hint ? <p className="text-xs text-text-secondary-on-dark/60">{hint}</p> : null}
    </div>
  );
}
