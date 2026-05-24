/**
 * Entity registry — the allowlist that bounds the custom report builder.
 *
 * Pure code, no DB. Every base entity declares its FROM clause, its read-only
 * joins, and the exact set of queryable fields. A field's `expr` is a trusted,
 * code-defined SQL fragment (a column reference, never user input) so it is safe
 * to inline via sql.raw in the compiler. Any field key not present here is
 * rejected at compile time — there is no `select *` and no raw-SQL surface.
 *
 * Relation fields (account name, driver name, truck unit) resolve through
 * read-only LEFT JOINs; we never write Fleet/Account-owned tables here.
 */
import type { ReportBaseEntity, ReportFieldKind } from '@ustowdispatch/shared';

export interface RegistryField {
  readonly label: string;
  readonly kind: ReportFieldKind;
  /** Trusted SQL expression (column ref). NEVER derived from user input. */
  readonly expr: string;
  /** May appear in GROUP BY. */
  readonly groupable: boolean;
  /** May be SUM-aggregated in a grouped query (numeric/cents only). */
  readonly aggregatable: boolean;
}

export interface EntityDef {
  readonly entity: ReportBaseEntity;
  readonly label: string;
  /** Base table + alias, e.g. "jobs j". */
  readonly from: string;
  /** Read-only join clauses, concatenated verbatim. */
  readonly joins: readonly string[];
  /** Tenant-id column on the base table (defense-in-depth alongside RLS). */
  readonly tenantCol: string;
  /** Soft-delete column on the base table, or null if the table has none. */
  readonly deletedCol: string | null;
  readonly fields: Readonly<Record<string, RegistryField>>;
}

const f = (
  label: string,
  kind: ReportFieldKind,
  expr: string,
  opts: { groupable?: boolean; aggregatable?: boolean } = {},
): RegistryField => ({
  label,
  kind,
  expr,
  groupable: opts.groupable ?? true,
  aggregatable: opts.aggregatable ?? false,
});

const cents = (label: string, expr: string): RegistryField =>
  f(label, 'cents', expr, { groupable: false, aggregatable: true });

export const ENTITY_REGISTRY: Readonly<Record<ReportBaseEntity, EntityDef>> = {
  jobs: {
    entity: 'jobs',
    label: 'Jobs',
    from: 'jobs j',
    joins: [
      'LEFT JOIN accounts a ON a.id = j.account_id',
      'LEFT JOIN drivers d ON d.id = j.assigned_driver_id',
      'LEFT JOIN trucks t ON t.id = j.assigned_truck_id',
    ],
    tenantCol: 'j.tenant_id',
    deletedCol: 'j.deleted_at',
    fields: {
      job_number: f('Job #', 'string', 'j.job_number'),
      status: f('Status', 'string', 'j.status'),
      service_type: f('Service type', 'string', 'j.service_type'),
      account_name: f('Account', 'string', 'a.name'),
      is_motor_club: f('Motor club', 'boolean', 'coalesce(a.is_motor_club, false)'),
      driver_name: f(
        'Driver',
        'string',
        "nullif(trim(concat_ws(' ', d.first_name, d.last_name)), '')",
      ),
      truck_unit: f('Truck', 'string', 't.unit_number'),
      rate_quoted_cents: cents('Rate quoted', 'j.rate_quoted_cents'),
      assigned_at: f('Assigned at', 'date', 'j.assigned_at'),
      created_at: f('Created at', 'date', 'j.created_at'),
    },
  },
  invoices: {
    entity: 'invoices',
    label: 'Invoices',
    from: 'invoices i',
    joins: ['LEFT JOIN accounts a ON a.id = i.account_id'],
    tenantCol: 'i.tenant_id',
    deletedCol: 'i.deleted_at',
    fields: {
      invoice_number: f('Invoice #', 'string', 'i.invoice_number'),
      invoice_type: f('Type', 'string', 'i.invoice_type'),
      status: f('Status', 'string', 'i.status'),
      account_name: f('Account', 'string', 'a.name'),
      issued_at: f('Issued at', 'date', 'i.issued_at'),
      due_at: f('Due at', 'date', 'i.due_at'),
      paid_at: f('Paid at', 'date', 'i.paid_at'),
      subtotal_cents: cents('Subtotal', 'i.subtotal_cents'),
      tax_cents: cents('Tax', 'i.tax_cents'),
      total_cents: cents('Total', 'i.total_cents'),
      paid_cents: cents('Paid', 'i.paid_cents'),
      balance_cents: cents('Balance', 'i.balance_cents'),
      created_at: f('Created at', 'date', 'i.created_at'),
    },
  },
  accounts: {
    entity: 'accounts',
    label: 'Accounts',
    from: 'accounts a',
    joins: [],
    tenantCol: 'a.tenant_id',
    deletedCol: 'a.deleted_at',
    fields: {
      name: f('Name', 'string', 'a.name'),
      account_number: f('Account #', 'string', 'a.account_number'),
      billing_terms: f('Billing terms', 'string', 'a.billing_terms'),
      payment_terms: f('Payment terms', 'string', 'a.payment_terms'),
      is_motor_club: f('Motor club', 'boolean', 'a.is_motor_club'),
      active: f('Active', 'boolean', 'a.active'),
      credit_limit: f('Credit limit', 'number', 'a.credit_limit', {
        groupable: false,
        aggregatable: true,
      }),
      created_at: f('Created at', 'date', 'a.created_at'),
    },
  },
  impound: {
    entity: 'impound',
    label: 'Impound',
    from: 'impound_records ir',
    joins: [],
    tenantCol: 'ir.tenant_id',
    deletedCol: 'ir.deleted_at',
    fields: {
      status: f('Status', 'string', 'ir.status'),
      vehicle_vin: f('VIN', 'string', 'ir.vehicle_vin'),
      license_plate: f('Plate', 'string', 'ir.license_plate'),
      license_state: f('Plate state', 'string', 'ir.license_state'),
      vehicle_make: f('Make', 'string', 'ir.vehicle_make'),
      vehicle_model: f('Model', 'string', 'ir.vehicle_model'),
      lien_eligible: f('Lien eligible', 'boolean', 'ir.lien_eligible'),
      arrived_at: f('Arrived at', 'date', 'ir.arrived_at'),
      storage_started_at: f('Storage started', 'date', 'ir.storage_started_at'),
      released_at: f('Released at', 'date', 'ir.released_at'),
      daily_fee_cents: cents('Daily fee', 'ir.daily_fee_cents'),
      accrued_fee_cents: cents('Accrued fees', 'ir.accrued_fee_cents'),
      created_at: f('Created at', 'date', 'ir.created_at'),
    },
  },
  lien_cases: {
    entity: 'lien_cases',
    label: 'Lien cases',
    from: 'lien_cases lc',
    joins: [],
    tenantCol: 'lc.tenant_id',
    deletedCol: 'lc.deleted_at',
    fields: {
      state: f('State', 'string', 'lc.state'),
      status: f('Status', 'string', 'lc.status'),
      current_step: f('Current step', 'string', 'lc.current_step'),
      vehicle_value_tier: f('Value tier', 'string', 'lc.vehicle_value_tier'),
      estimated_value_cents: cents('Estimated value', 'lc.estimated_value_cents'),
      opened_at: f('Opened at', 'date', 'lc.opened_at'),
      next_action_due_at: f('Next action due', 'date', 'lc.next_action_due_at'),
      ready_for_sale_at: f('Ready for sale', 'date', 'lc.ready_for_sale_at'),
      sold_at: f('Sold at', 'date', 'lc.sold_at'),
      created_at: f('Created at', 'date', 'lc.created_at'),
    },
  },
  drivers: {
    entity: 'drivers',
    label: 'Drivers',
    from: 'drivers d',
    joins: [],
    tenantCol: 'd.tenant_id',
    deletedCol: 'd.deleted_at',
    fields: {
      employee_number: f('Employee #', 'string', 'd.employee_number'),
      first_name: f('First name', 'string', 'd.first_name'),
      last_name: f('Last name', 'string', 'd.last_name'),
      phone: f('Phone', 'string', 'd.phone'),
      email: f('Email', 'string', 'd.email'),
      cdl_class: f('CDL class', 'string', 'd.cdl_class'),
      employment_status: f('Employment status', 'string', 'd.employment_status'),
      active: f('Active', 'boolean', 'd.active'),
      hired_at: f('Hired at', 'date', 'd.hired_at'),
      created_at: f('Created at', 'date', 'd.created_at'),
    },
  },
  trucks: {
    entity: 'trucks',
    label: 'Trucks',
    from: 'trucks t',
    joins: [],
    tenantCol: 't.tenant_id',
    deletedCol: 't.deleted_at',
    fields: {
      unit_number: f('Unit #', 'string', 't.unit_number'),
      truck_type: f('Type', 'string', 't.truck_type'),
      make: f('Make', 'string', 't.make'),
      model: f('Model', 'string', 't.model'),
      capacity_class: f('Capacity class', 'string', 't.capacity_class'),
      fuel_type: f('Fuel type', 'string', 't.fuel_type'),
      status: f('Status', 'string', 't.status'),
      in_service: f('In service', 'boolean', 't.in_service'),
      heavy_duty_capable: f('Heavy-duty', 'boolean', 't.heavy_duty_capable'),
      created_at: f('Created at', 'date', 't.created_at'),
    },
  },
};

/** Wire-shape registry for the builder UI (no SQL exprs leaked). */
export function registryForWire(): Array<{
  entity: ReportBaseEntity;
  label: string;
  fields: Array<{
    key: string;
    label: string;
    kind: ReportFieldKind;
    groupable: boolean;
    aggregatable: boolean;
  }>;
}> {
  return Object.values(ENTITY_REGISTRY).map((def) => ({
    entity: def.entity,
    label: def.label,
    fields: Object.entries(def.fields).map(([key, meta]) => ({
      key,
      label: meta.label,
      kind: meta.kind,
      groupable: meta.groupable,
      aggregatable: meta.aggregatable,
    })),
  }));
}
