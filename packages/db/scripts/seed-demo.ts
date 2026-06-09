/**
 * seed-demo.ts — Session 9.5 demo tenant seeder.
 *
 * Seeds "Roadside Towing and Recovery, Inc." (slug: roadside) with a curated
 * walkthrough dataset for the founder demo: 11 users, 16 trucks across two
 * yards, six drivers, three customer types, three rate sheets, OH-style tax
 * settings, and exactly eight jobs in carefully chosen lifecycle states plus
 * one 90-day write-off.
 *
 * Usage:
 *   pnpm db:seed:demo                                # local (default)
 *   pnpm db:seed:demo --target=staging
 *   SEED_DEMO_CONFIRM=YES_I_AM_SURE pnpm db:seed:demo --target=production
 *   pnpm db:seed:demo --reset                        # nuke tenant first
 *
 * Re-running without --reset is idempotent: every entity has a deterministic
 * UUID derived from sha1(`roadside:<kind>:<key>`) and inserts use
 * ON CONFLICT DO NOTHING / find-or-create. With --reset, the demo tenant is
 * deleted (cascading by FK order) before the seed runs.
 *
 * Production guard: --target=production refuses unless SEED_DEMO_CONFIRM is
 * literally `YES_I_AM_SURE`. There is no other safety net.
 *
 * Money is integer cents throughout. Dates are computed relative to "now"
 * at run time, then frozen into each row's timestamps so the walkthrough
 * narrative stays coherent (job completed → invoice issued → payment).
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
const { Pool } = pg;
import * as schema from '../src/schema/index';

// ────────────────────────────────────────────────────────────────────────────
// Constants & deterministic ID helpers
// ────────────────────────────────────────────────────────────────────────────

const TENANT_SLUG = 'roadside';
const TENANT_NAME = 'Roadside Towing and Recovery, Inc.';
const DEMO_PASSWORD = 'TempPass#001';
const INVOICE_PREFIX = 'ROAD';
const INVOICE_YEAR = '2026';

/**
 * Deterministic UUID-shaped string from sha1(`roadside:<scope>:<key>`).
 * Same scope+key produces the same ID across runs, which is what makes the
 * seed safely re-runnable without --reset.
 */
function detId(scope: string, key: string): string {
  const h = createHash('sha1').update(`${TENANT_SLUG}:${scope}:${key}`).digest('hex');
  const v3rd = ((Number.parseInt(h.slice(12, 13), 16) & 0x3) | 0x8).toString(16); // variant nibble
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`, // version 4
    `${v3rd}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
}

const log = (msg: string): void => {
  process.stdout.write(`[seed-demo] ${msg}\n`);
};

// ────────────────────────────────────────────────────────────────────────────
// CLI parsing
// ────────────────────────────────────────────────────────────────────────────

type Target = 'production' | 'staging' | 'local';
interface CliArgs {
  target: Target;
  reset: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { target: 'local', reset: false };
  for (const a of argv) {
    if (a === '--reset') args.reset = true;
    else if (a.startsWith('--target=')) {
      const v = a.slice('--target='.length);
      if (v !== 'production' && v !== 'staging' && v !== 'local') {
        throw new Error(`invalid --target=${v}; must be production|staging|local`);
      }
      args.target = v;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write('Usage: seed-demo [--target=production|staging|local] [--reset]\n');
      process.exit(0);
    }
  }
  return args;
}

// ────────────────────────────────────────────────────────────────────────────
// Demo data shapes
// ────────────────────────────────────────────────────────────────────────────

const YARDS = [
  {
    key: 'main',
    name: 'Main Yard — Columbus',
    address: {
      street: '1450 Joyce Avenue',
      city: 'Columbus',
      state: 'OH',
      zip: '43219',
    },
  },
  {
    key: 'lewis',
    name: 'Lewis Center Yard',
    address: {
      street: '8240 Worthington Galena Road',
      city: 'Lewis Center',
      state: 'OH',
      zip: '43035',
    },
  },
] as const;

interface UserSeed {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  role: schema.UserRole;
}

const USERS: UserSeed[] = [
  {
    key: 'owner',
    email: 'chris@roadside.demo',
    firstName: 'Chris',
    lastName: 'Peer',
    role: 'owner',
  },
  {
    key: 'admin',
    email: 'dana.admin@roadside.demo',
    firstName: 'Dana',
    lastName: 'Mercer',
    role: 'admin',
  },
  {
    key: 'accounting',
    email: 'priya.accounting@roadside.demo',
    firstName: 'Priya',
    lastName: 'Shah',
    role: 'accounting',
  },
  {
    key: 'auditor',
    email: 'frank.audit@roadside.demo',
    firstName: 'Frank',
    lastName: 'Delgado',
    role: 'auditor',
  },
  {
    key: 'manager',
    email: 'kevin.manager@roadside.demo',
    firstName: 'Kevin',
    lastName: "O'Rourke",
    role: 'manager',
  },
  {
    key: 'disp_1',
    email: 'maria.dispatch@roadside.demo',
    firstName: 'Maria',
    lastName: 'Vasquez',
    role: 'dispatcher',
  },
  {
    key: 'disp_2',
    email: 'andre.dispatch@roadside.demo',
    firstName: 'Andre',
    lastName: 'Bennett',
    role: 'dispatcher',
  },
  // Drivers also get login users (driver app login).
  {
    key: 'drv_1',
    email: 'jamal.washington@roadside.demo',
    firstName: 'Jamal',
    lastName: 'Washington',
    role: 'driver',
  },
  {
    key: 'drv_2',
    email: 'tyler.kowalski@roadside.demo',
    firstName: 'Tyler',
    lastName: 'Kowalski',
    role: 'driver',
  },
  {
    key: 'drv_3',
    email: 'rosa.martinez@roadside.demo',
    firstName: 'Rosa',
    lastName: 'Martinez',
    role: 'driver',
  },
  {
    key: 'drv_4',
    email: 'devon.nguyen@roadside.demo',
    firstName: 'Devon',
    lastName: 'Nguyen',
    role: 'driver',
  },
  {
    key: 'drv_5',
    email: 'shawn.obrien@roadside.demo',
    firstName: 'Shawn',
    lastName: "O'Brien",
    role: 'driver',
  },
  {
    key: 'drv_6',
    email: 'marcus.thompson@roadside.demo',
    firstName: 'Marcus',
    lastName: 'Thompson',
    role: 'driver',
  },
];

interface TruckSeed {
  unit: string;
  yardKey: 'main' | 'lewis';
  type: schema.TruckType;
  capacity: schema.TruckCapacityClass;
  year: string;
  make: string;
  model: string;
  vin: string;
  plate: string;
  fuel: schema.TruckFuelType;
  equipment: schema.TruckEquipment[];
  primaryDriverKey?: string;
}

// 10 light-duty, 4 medium-duty, 2 heavy-duty across the 2 yards.
const TRUCKS: TruckSeed[] = [
  // Main Yard — Columbus
  {
    unit: '101',
    yardKey: 'main',
    type: 'flatbed',
    capacity: 'light',
    year: '2023',
    make: 'Ford',
    model: 'F-550',
    vin: '1FDUF5HT8PEC10101',
    plate: 'PMK1101',
    fuel: 'diesel',
    equipment: ['flatbed', 'wheel_lift', 'dollies', 'jump_pack'],
    primaryDriverKey: 'drv_1',
  },
  {
    unit: '102',
    yardKey: 'main',
    type: 'flatbed',
    capacity: 'light',
    year: '2022',
    make: 'Ford',
    model: 'F-550',
    vin: '1FDUF5HT0NEC10102',
    plate: 'PMK1102',
    fuel: 'diesel',
    equipment: ['flatbed', 'wheel_lift', 'jump_pack'],
    primaryDriverKey: 'drv_2',
  },
  {
    unit: '103',
    yardKey: 'main',
    type: 'wheel_lift',
    capacity: 'light',
    year: '2021',
    make: 'Dodge',
    model: 'Ram 5500',
    vin: '3C7WRNFL4MG010103',
    plate: 'PMK1103',
    fuel: 'diesel',
    equipment: ['wheel_lift', 'dollies', 'winch'],
    primaryDriverKey: 'drv_3',
  },
  {
    unit: '104',
    yardKey: 'main',
    type: 'wheel_lift',
    capacity: 'light',
    year: '2020',
    make: 'Dodge',
    model: 'Ram 5500',
    vin: '3C7WRNFL8LG010104',
    plate: 'PMK1104',
    fuel: 'diesel',
    equipment: ['wheel_lift', 'dollies'],
  },
  {
    unit: '105',
    yardKey: 'main',
    type: 'flatbed',
    capacity: 'light',
    year: '2019',
    make: 'Ford',
    model: 'F-550',
    vin: '1FDUF5HT0KEC10105',
    plate: 'PMK1105',
    fuel: 'diesel',
    equipment: ['flatbed'],
  },
  {
    unit: '106',
    yardKey: 'main',
    type: 'flatbed',
    capacity: 'light',
    year: '2018',
    make: 'Dodge',
    model: 'Ram 5500',
    vin: '3C7WRNFL5JG010106',
    plate: 'PMK1106',
    fuel: 'diesel',
    equipment: ['flatbed'],
  },
  {
    unit: '107',
    yardKey: 'main',
    type: 'medium_duty',
    capacity: 'medium',
    year: '2022',
    make: 'Peterbilt',
    model: '337',
    vin: '2NPNHM7X6NM010107',
    plate: 'PMK1107',
    fuel: 'diesel',
    equipment: ['wrecker_medium', 'wheel_lift', 'winch'],
    primaryDriverKey: 'drv_4',
  },
  {
    unit: '108',
    yardKey: 'main',
    type: 'medium_duty',
    capacity: 'medium',
    year: '2020',
    make: 'Kenworth',
    model: 'T370',
    vin: '2NKHHM7X8LM010108',
    plate: 'PMK1108',
    fuel: 'diesel',
    equipment: ['wrecker_medium', 'wheel_lift'],
  },
  {
    unit: '109',
    yardKey: 'main',
    type: 'heavy_duty',
    capacity: 'heavy',
    year: '2024',
    make: 'Peterbilt',
    model: '567 Rotator',
    vin: '1XPBD49X8RD010109',
    plate: 'PMK1109',
    fuel: 'diesel',
    equipment: ['wrecker_heavy', 'sliding_rotator', 'winch'],
    primaryDriverKey: 'drv_5',
  },
  {
    unit: '110',
    yardKey: 'main',
    type: 'service',
    capacity: 'light',
    year: '2021',
    make: 'Ford',
    model: 'F-350 Service',
    vin: '1FT8W3DT0MEC10110',
    plate: 'PMK1110',
    fuel: 'gas',
    equipment: ['jump_pack'],
  },
  // Lewis Center Yard
  {
    unit: '111',
    yardKey: 'lewis',
    type: 'flatbed',
    capacity: 'light',
    year: '2023',
    make: 'Ford',
    model: 'F-550',
    vin: '1FDUF5HT2PEC10111',
    plate: 'PMK1111',
    fuel: 'diesel',
    equipment: ['flatbed', 'wheel_lift', 'dollies'],
    primaryDriverKey: 'drv_6',
  },
  {
    unit: '112',
    yardKey: 'lewis',
    type: 'flatbed',
    capacity: 'light',
    year: '2022',
    make: 'Dodge',
    model: 'Ram 5500',
    vin: '3C7WRNFL6NG010112',
    plate: 'PMK1112',
    fuel: 'diesel',
    equipment: ['flatbed', 'wheel_lift'],
  },
  {
    unit: '113',
    yardKey: 'lewis',
    type: 'wheel_lift',
    capacity: 'light',
    year: '2020',
    make: 'Ford',
    model: 'F-550',
    vin: '1FDUF5HT0LEC10113',
    plate: 'PMK1113',
    fuel: 'diesel',
    equipment: ['wheel_lift', 'dollies'],
  },
  {
    unit: '114',
    yardKey: 'lewis',
    type: 'flatbed',
    capacity: 'light',
    year: '2019',
    make: 'Dodge',
    model: 'Ram 5500',
    vin: '3C7WRNFL8KG010114',
    plate: 'PMK1114',
    fuel: 'diesel',
    equipment: ['flatbed'],
  },
  {
    unit: '115',
    yardKey: 'lewis',
    type: 'medium_duty',
    capacity: 'medium',
    year: '2023',
    make: 'Peterbilt',
    model: '337',
    vin: '2NPNHM7X9PM010115',
    plate: 'PMK1115',
    fuel: 'diesel',
    equipment: ['wrecker_medium', 'wheel_lift'],
  },
  {
    unit: '116',
    yardKey: 'lewis',
    type: 'heavy_duty',
    capacity: 'HD',
    year: '2022',
    make: 'Kenworth',
    model: 'T880',
    vin: '1NKZL40X4NJ010116',
    plate: 'PMK1116',
    fuel: 'diesel',
    equipment: ['wrecker_heavy', 'winch', 'dollies'],
  },
];

interface DriverSeed {
  key: string;
  empNum: string;
  firstName: string;
  lastName: string;
  cdl: schema.DriverCdlClass;
  yardKey: 'main' | 'lewis';
  userKey: string;
}

const DRIVERS: DriverSeed[] = [
  {
    key: 'drv_1',
    empNum: 'R-D01',
    firstName: 'Jamal',
    lastName: 'Washington',
    cdl: 'B',
    yardKey: 'main',
    userKey: 'drv_1',
  },
  {
    key: 'drv_2',
    empNum: 'R-D02',
    firstName: 'Tyler',
    lastName: 'Kowalski',
    cdl: 'B',
    yardKey: 'main',
    userKey: 'drv_2',
  },
  {
    key: 'drv_3',
    empNum: 'R-D03',
    firstName: 'Rosa',
    lastName: 'Martinez',
    cdl: 'B',
    yardKey: 'main',
    userKey: 'drv_3',
  },
  {
    key: 'drv_4',
    empNum: 'R-D04',
    firstName: 'Devon',
    lastName: 'Nguyen',
    cdl: 'A',
    yardKey: 'main',
    userKey: 'drv_4',
  },
  {
    key: 'drv_5',
    empNum: 'R-D05',
    firstName: 'Shawn',
    lastName: "O'Brien",
    cdl: 'A',
    yardKey: 'main',
    userKey: 'drv_5',
  },
  {
    key: 'drv_6',
    empNum: 'R-D06',
    firstName: 'Marcus',
    lastName: 'Thompson',
    cdl: 'B',
    yardKey: 'lewis',
    userKey: 'drv_6',
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Rate sheet definitions (shape per @towdispatch/shared rateSheetDefinitionSchema)
// ────────────────────────────────────────────────────────────────────────────

const FULL_VEHICLE_CLASS_RATES = {
  light_duty: 400,
  medium_duty: 600,
  heavy_duty: 1000,
  motorcycle: 400,
  commercial: 800,
  rv: 800,
  unknown: 400,
};

const DEFAULT_RETAIL_DEFINITION = {
  version: 1 as const,
  currency: 'USD' as const,
  freeMilesIncluded: 0,
  services: [
    {
      serviceType: 'tow' as const,
      baseCents: 12500,
      perMileCentsByClass: FULL_VEHICLE_CLASS_RATES,
      flatFeesByClass: {},
    },
    {
      serviceType: 'jump_start' as const,
      baseCents: 7500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'lockout' as const,
      baseCents: 6500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'tire_change' as const,
      baseCents: 8500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    { serviceType: 'fuel' as const, baseCents: 7500, perMileCentsByClass: {}, flatFeesByClass: {} },
    {
      serviceType: 'winch' as const,
      baseCents: 15000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'recovery' as const,
      baseCents: 15000,
      perMileCentsByClass: { ...FULL_VEHICLE_CLASS_RATES },
      flatFeesByClass: {},
    },
    {
      serviceType: 'impound' as const,
      baseCents: 12500,
      perMileCentsByClass: { ...FULL_VEHICLE_CLASS_RATES },
      flatFeesByClass: {},
    },
    {
      serviceType: 'other' as const,
      baseCents: 10000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
  ],
  // Native definition cannot represent a % surcharge. The 25% after-hours
  // premium is documented in tenants.settings.billingPolicies and applied at
  // invoice time; the surcharge entry below is a placeholder so the UI shows
  // a configured window.
  surcharges: [
    {
      code: 'after_hours',
      label: 'After-hours surcharge (25% — applied at invoice)',
      startHHmm: '20:00',
      endHHmm: '06:00',
      crossesMidnight: true,
      amountCents: 0,
      daysOfWeek: [],
    },
  ],
  fixedLineItems: [
    { code: 'environmental_fee', label: 'Environmental fee', amountCents: 2500 },
    { code: 'admin_fee', label: 'Admin fee', amountCents: 3500 },
  ],
};

const AAAX_DEFINITION = {
  version: 1 as const,
  currency: 'USD' as const,
  freeMilesIncluded: 0,
  services: [
    {
      serviceType: 'tow' as const,
      baseCents: 8500,
      perMileCentsByClass: {
        light_duty: 350,
        medium_duty: 500,
        heavy_duty: 900,
        motorcycle: 350,
        commercial: 700,
        rv: 700,
        unknown: 350,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'jump_start' as const,
      baseCents: 5500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'lockout' as const,
      baseCents: 5000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'tire_change' as const,
      baseCents: 6500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    { serviceType: 'fuel' as const, baseCents: 5500, perMileCentsByClass: {}, flatFeesByClass: {} },
    {
      serviceType: 'winch' as const,
      baseCents: 11000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'recovery' as const,
      baseCents: 12000,
      perMileCentsByClass: { light_duty: 500 },
      flatFeesByClass: {},
    },
    {
      serviceType: 'impound' as const,
      baseCents: 8500,
      perMileCentsByClass: { light_duty: 350 },
      flatFeesByClass: {},
    },
    {
      serviceType: 'other' as const,
      baseCents: 8000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
  ],
  surcharges: [], // no after-hours premium per motor club contract
  fixedLineItems: [
    { code: 'environmental_fee', label: 'Environmental fee', amountCents: 2500 },
    // No admin fee per motor club standard.
  ],
};

// 15% off the retail line items.
const SHEETZX_DEFINITION = {
  version: 1 as const,
  currency: 'USD' as const,
  freeMilesIncluded: 0,
  services: [
    {
      serviceType: 'tow' as const,
      baseCents: 10625, // 12500 × 0.85
      perMileCentsByClass: {
        light_duty: 340,
        medium_duty: 510,
        heavy_duty: 850,
        motorcycle: 340,
        commercial: 680,
        rv: 680,
        unknown: 340,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'jump_start' as const,
      baseCents: 6375,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'lockout' as const,
      baseCents: 5525,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'tire_change' as const,
      baseCents: 7225,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    { serviceType: 'fuel' as const, baseCents: 6375, perMileCentsByClass: {}, flatFeesByClass: {} },
    {
      serviceType: 'winch' as const,
      baseCents: 12750,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'recovery' as const,
      baseCents: 12750,
      perMileCentsByClass: { light_duty: 340 },
      flatFeesByClass: {},
    },
    {
      serviceType: 'impound' as const,
      baseCents: 10625,
      perMileCentsByClass: { light_duty: 340 },
      flatFeesByClass: {},
    },
    {
      serviceType: 'other' as const,
      baseCents: 8500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
  ],
  surcharges: [
    {
      code: 'after_hours',
      label: 'After-hours surcharge (25% — applied at invoice)',
      startHHmm: '20:00',
      endHHmm: '06:00',
      crossesMidnight: true,
      amountCents: 0,
      daysOfWeek: [],
    },
  ],
  fixedLineItems: [
    { code: 'environmental_fee', label: 'Environmental fee', amountCents: 2125 }, // 2500 × 0.85
    { code: 'admin_fee', label: 'Admin fee', amountCents: 2975 }, // 3500 × 0.85
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Connection
// ────────────────────────────────────────────────────────────────────────────

function dbUrlFor(target: Target): string {
  // Production / staging require explicit URLs. Local falls back to the dev
  // DATABASE_ADMIN_URL or DATABASE_URL, matching the existing migrate/seed.
  if (target === 'production') {
    const u = process.env.PRODUCTION_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;
    if (!u)
      throw new Error(
        'PRODUCTION_DATABASE_ADMIN_URL (or DATABASE_ADMIN_URL) must be set for --target=production',
      );
    return u;
  }
  if (target === 'staging') {
    const u = process.env.STAGING_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;
    if (!u)
      throw new Error(
        'STAGING_DATABASE_ADMIN_URL (or DATABASE_ADMIN_URL) must be set for --target=staging',
      );
    return u;
  }
  const u = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set for --target=local');
  return u;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — time math
// ────────────────────────────────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
function daysAgo(d: number, now: Date): Date {
  return new Date(now.getTime() - d * DAY);
}
function hoursAgo(h: number, now: Date): Date {
  return new Date(now.getTime() - h * HOUR);
}
function minutesAgo(m: number, now: Date): Date {
  return new Date(now.getTime() - m * MIN);
}
function plusMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * MIN);
}

// ────────────────────────────────────────────────────────────────────────────
// Reset — delete the demo tenant (and everything that references it).
// Order respects the FK graph: leaf-most rows first so RESTRICT clauses don't
// trip. tenants is RESTRICT for almost every child, so this list must stay
// complete. Adding a new child table? Add a delete here.
// ────────────────────────────────────────────────────────────────────────────

async function resetTenant(
  db: ReturnType<typeof drizzle<typeof schema>>,
  tenantId: string,
): Promise<void> {
  log(`reset: deleting all rows for tenant ${tenantId}`);
  // Children-of-invoices first.
  await db.delete(schema.payments).where(eq(schema.payments.tenantId, tenantId));
  await db.delete(schema.creditMemos).where(eq(schema.creditMemos.tenantId, tenantId));
  await db.delete(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.tenantId, tenantId));
  await db.delete(schema.invoiceTaxes).where(eq(schema.invoiceTaxes.tenantId, tenantId));
  await db
    .delete(schema.recurringBillingSchedules)
    .where(eq(schema.recurringBillingSchedules.tenantId, tenantId));
  await db.delete(schema.invoices).where(eq(schema.invoices.tenantId, tenantId));
  await db
    .delete(schema.invoiceNumberSequences)
    .where(eq(schema.invoiceNumberSequences.tenantId, tenantId));
  // Jobs + transitions + sequences.
  await db
    .delete(schema.jobStatusTransitions)
    .where(eq(schema.jobStatusTransitions.tenantId, tenantId));
  await db.delete(schema.jobs).where(eq(schema.jobs.tenantId, tenantId));
  await db
    .delete(schema.jobNumberSequences)
    .where(eq(schema.jobNumberSequences.tenantId, tenantId));
  // Driver-side.
  await db.delete(schema.driverShifts).where(eq(schema.driverShifts.tenantId, tenantId));
  await db
    .delete(schema.driverTruckAssignments)
    .where(eq(schema.driverTruckAssignments.tenantId, tenantId));
  await db.delete(schema.drivers).where(eq(schema.drivers.tenantId, tenantId));
  // Trucks.
  await db.delete(schema.trucks).where(eq(schema.trucks.tenantId, tenantId));
  // Customer-vehicle links + the entities they bind.
  await db.delete(schema.customerVehicles).where(eq(schema.customerVehicles.tenantId, tenantId));
  await db.delete(schema.vehicles).where(eq(schema.vehicles.tenantId, tenantId));
  await db.delete(schema.customers).where(eq(schema.customers.tenantId, tenantId));
  // Rate sheets pointer + sheets + accounts.
  await db
    .delete(schema.tenantDefaultRateSheets)
    .where(eq(schema.tenantDefaultRateSheets.tenantId, tenantId));
  await db.delete(schema.rateSheets).where(eq(schema.rateSheets.tenantId, tenantId));
  await db.delete(schema.accounts).where(eq(schema.accounts.tenantId, tenantId));
  // Auth tokens etc., then users, then the tenant row itself.
  await db.delete(schema.sessions).where(eq(schema.sessions.tenantId, tenantId));
  await db
    .delete(schema.emailVerificationTokens)
    .where(eq(schema.emailVerificationTokens.tenantId, tenantId));
  await db
    .delete(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.tenantId, tenantId));
  // audit_log has RESTRICT on tenant — clear it last, before the tenant.
  await db.delete(schema.auditLog).where(eq(schema.auditLog.tenantId, tenantId));
  await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  log('reset: complete');
}

// ────────────────────────────────────────────────────────────────────────────
// Main seed
// ────────────────────────────────────────────────────────────────────────────

interface Counts {
  tenants: number;
  yards: number;
  users: number;
  drivers: number;
  trucks: number;
  driverTruckAssignments: number;
  driverShifts: number;
  rateSheets: number;
  accounts: number;
  customers: number;
  vehicles: number;
  customerVehicles: number;
  jobs: number;
  invoices: number;
  invoiceLineItems: number;
  payments: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.target === 'production' && process.env.SEED_DEMO_CONFIRM !== 'YES_I_AM_SURE') {
    process.stderr.write(
      '[seed-demo] refusing --target=production without SEED_DEMO_CONFIRM=YES_I_AM_SURE\n',
    );
    process.exit(2);
  }

  const url = dbUrlFor(args.target);
  log(`target=${args.target} reset=${args.reset}`);

  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const now = new Date();
  const counts: Counts = {
    tenants: 0,
    yards: YARDS.length,
    users: 0,
    drivers: 0,
    trucks: 0,
    driverTruckAssignments: 0,
    driverShifts: 0,
    rateSheets: 0,
    accounts: 0,
    customers: 0,
    vehicles: 0,
    customerVehicles: 0,
    jobs: 0,
    invoices: 0,
    invoiceLineItems: 0,
    payments: 0,
  };

  try {
    // ──── reset (find tenant by slug first) ──────────────────────────────
    if (args.reset) {
      const existing = await db.query.tenants.findFirst({
        where: eq(schema.tenants.slug, TENANT_SLUG),
      });
      if (existing) await resetTenant(db, existing.id);
      else log('reset: tenant did not exist, nothing to delete');
    }

    // ──── tenant ─────────────────────────────────────────────────────────
    const tenantId = detId('tenant', TENANT_SLUG);
    const tenantSettings = {
      brand: {
        logoUrl: 'https://placehold.co/256x256/0a2540/ffffff/png?text=R',
      },
      contact: {
        address: { street: '2050 Cleveland Avenue', city: 'Columbus', state: 'OH', zip: '43211' },
        phone: '+16142554700',
        billingEmail: 'billing@roadside.demo',
      },
      yards: YARDS.map((y) => ({ id: detId('yard', y.key), name: y.name, address: y.address })),
      truckYardAssignments: TRUCKS.reduce<Record<string, string>>((acc, t) => {
        acc[t.unit] = detId('yard', t.yardKey);
        return acc;
      }, {}),
      accounting: { integrationStatus: 'disconnected' as const, provider: null },
      billingPolicies: {
        afterHoursSurchargePct: 25,
        afterHoursWindow: { startHHmm: '20:00', endHHmm: '06:00' },
        waitTime: { graceMinutes: 15, perHourCents: 7500 },
        storage: { dailyLightCents: 4500, dailyMediumCents: 7500, dailyHeavyCents: 12500 },
      },
      taxRates: [
        {
          code: 'oh_state',
          name: 'Ohio State Sales Tax',
          ratePct: '5.7500',
          jurisdiction: 'OH-STATE',
        },
        {
          code: 'franklin_county',
          name: 'Franklin County Sales Tax',
          ratePct: '1.5000',
          jurisdiction: 'OH-FRANKLIN',
        },
      ],
      taxability: {
        // OH treats labor / towing services as non-taxable, parts and storage as taxable.
        taxableLineTypes: ['storage_daily'],
        nonTaxableLineTypes: [
          'service',
          'mileage_loaded',
          'mileage_unloaded',
          'wait_time',
          'winch',
          'recovery',
          'after_hours',
          'environmental',
          'admin',
        ],
      },
      demoSeed: { version: 1, generatedAt: now.toISOString() },
    };

    const existingTenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (existingTenant) {
      // Refresh settings so re-runs without --reset still propagate edits.
      await db
        .update(schema.tenants)
        .set({ settings: tenantSettings, updatedAt: now })
        .where(eq(schema.tenants.id, tenantId));
      log(`tenant ${TENANT_SLUG} already exists — settings refreshed`);
    } else {
      await db.insert(schema.tenants).values({
        id: tenantId,
        slug: TENANT_SLUG,
        name: TENANT_NAME,
        status: 'active',
        settings: tenantSettings,
      });
      log(`inserted tenant ${TENANT_SLUG} (${tenantId})`);
    }
    counts.tenants = 1;

    // ──── users ──────────────────────────────────────────────────────────
    const userIds: Record<string, string> = {};
    for (const u of USERS) {
      const id = detId('user', u.email);
      userIds[u.key] = id;
      const existing = await db.query.users.findFirst({
        where: and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, u.email)),
      });
      if (existing) continue;
      await db.insert(schema.users).values({
        id,
        tenantId,
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        isActive: true,
        // emailVerifiedAt left null + lastLoginAt left null — the app uses the
        // null lastLoginAt as the "force password rotation on first login"
        // signal, which is the must_change_password=true contract from spec.
      });
      counts.users++;
      log(`  inserted user ${u.email} (${u.role})`);
    }
    if (counts.users === 0) log(`  users: all ${USERS.length} already existed`);
    const ownerUserId = userIds.owner;
    if (!ownerUserId) throw new Error('seed-demo: owner user was not seeded');
    counts.users = USERS.length; // total in tenant, idempotent count

    // Map-lookup helpers. With noUncheckedIndexedAccess on, raw indexing is
    // `T | undefined`; these narrow it to `T` (req) or `T | null` (opt) so
    // Drizzle's exactOptionalPropertyTypes contract is satisfied.
    const req = (m: Record<string, string>, k: string, label: string): string => {
      const v = m[k];
      if (!v) throw new Error(`seed-demo: missing ${label} for key=${k}`);
      return v;
    };
    const opt = (m: Record<string, string>, k: string | null | undefined): string | null => {
      if (!k) return null;
      return m[k] ?? null;
    };

    // ──── rate sheets ────────────────────────────────────────────────────
    const rateSheetSpec = [
      {
        key: 'default',
        name: 'Default Retail',
        definition: DEFAULT_RETAIL_DEFINITION,
        notes:
          "Tenant-default rate card. 25% after-hours surcharge applied at invoice time (rate-sheet schema can't express %); wait time, storage, and tax handling live in tenant settings.",
      },
      {
        key: 'aaax',
        name: 'AAAX Motor Club',
        definition: AAAX_DEFINITION,
        notes:
          'AAAX motor club contract rates. No after-hours premium, no admin fee per motor club standard.',
      },
      {
        key: 'sheetzx',
        name: 'SheetzX Commercial',
        definition: SHEETZX_DEFINITION,
        notes: 'SheetzX commercial — 15% discount applied across all Default Retail line items.',
      },
    ] as const;

    const rateSheetIds: Record<string, string> = {};
    for (const rs of rateSheetSpec) {
      const id = detId('rate_sheet', rs.key);
      rateSheetIds[rs.key] = id;
      const existing = await db.query.rateSheets.findFirst({ where: eq(schema.rateSheets.id, id) });
      if (existing) {
        await db
          .update(schema.rateSheets)
          .set({ definition: rs.definition, notes: rs.notes, updatedAt: now })
          .where(eq(schema.rateSheets.id, id));
        continue;
      }
      await db.insert(schema.rateSheets).values({
        id,
        tenantId,
        name: rs.name,
        definition: rs.definition,
        notes: rs.notes,
        active: true,
        createdBy: ownerUserId,
      });
      counts.rateSheets++;
      log(`  inserted rate sheet ${rs.name}`);
    }
    counts.rateSheets = rateSheetSpec.length;

    // Mark Default Retail as tenant default.
    const defaultRateSheetId = req(rateSheetIds, 'default', 'default rate sheet');
    await db
      .insert(schema.tenantDefaultRateSheets)
      .values({ tenantId, rateSheetId: defaultRateSheetId, updatedBy: ownerUserId, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.tenantDefaultRateSheets.tenantId,
        set: { rateSheetId: defaultRateSheetId, updatedAt: now, updatedBy: ownerUserId },
      });

    // ──── accounts ───────────────────────────────────────────────────────
    interface AccountSeed {
      key: string;
      name: string;
      billingTerms: schema.BillingTerm;
      isMotorClub: boolean;
      motorClubNetworkCode: string | null;
      billingEmail: string;
      billingPhone: string;
      apContactName: string;
      apContactEmail: string;
      rateSheetKey: 'default' | 'aaax' | 'sheetzx';
      address: { street: string; city: string; state: string; zip: string };
    }
    const ACCOUNTS: AccountSeed[] = [
      {
        key: 'aaax',
        name: 'AAAX Motor Club',
        billingTerms: 'net_45',
        isMotorClub: true,
        motorClubNetworkCode: 'AAAX',
        billingEmail: 'remittance@aaax.example',
        billingPhone: '+18005550101',
        apContactName: 'Allison Park',
        apContactEmail: 'apark@aaax.example',
        rateSheetKey: 'aaax',
        address: { street: '1600 Embassy Plaza', city: 'Heathrow', state: 'FL', zip: '32746' },
      },
      {
        key: 'sheetzx',
        name: 'SheetzX, Inc.',
        billingTerms: 'net_30',
        isMotorClub: false,
        motorClubNetworkCode: null,
        billingEmail: 'ap@sheetzx.example',
        billingPhone: '+18145550199',
        apContactName: 'Greg Tomlin',
        apContactEmail: 'gtomlin@sheetzx.example',
        rateSheetKey: 'sheetzx',
        address: { street: '5700 6th Avenue', city: 'Altoona', state: 'PA', zip: '16602' },
      },
    ];

    const accountIds: Record<string, string> = {};
    for (const a of ACCOUNTS) {
      const id = detId('account', a.key);
      accountIds[a.key] = id;
      const rsId = req(rateSheetIds, a.rateSheetKey, `rate sheet ${a.rateSheetKey}`);
      const existing = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, id) });
      if (existing) {
        await db
          .update(schema.accounts)
          .set({ defaultRateSheetId: rsId, updatedAt: now })
          .where(eq(schema.accounts.id, id));
        continue;
      }
      await db.insert(schema.accounts).values({
        id,
        tenantId,
        name: a.name,
        billingTerms: a.billingTerms,
        creditLimit: a.isMotorClub ? null : '50000.00',
        billingAddress: a.address,
        billingEmail: a.billingEmail,
        billingPhone: a.billingPhone,
        apContactName: a.apContactName,
        apContactEmail: a.apContactEmail,
        isMotorClub: a.isMotorClub,
        motorClubNetworkCode: a.motorClubNetworkCode,
        defaultRateSheetId: rsId,
        active: true,
        createdBy: ownerUserId,
      });
      counts.accounts++;
      log(`  inserted account ${a.name}`);
    }
    counts.accounts = ACCOUNTS.length;

    // ──── customers ──────────────────────────────────────────────────────
    interface CustomerSeed {
      key: string;
      type: schema.CustomerType;
      name: string;
      email: string | null;
      phone: string;
      accountKey: 'aaax' | 'sheetzx' | null;
      rateSheetKey: 'aaax' | 'sheetzx' | null;
      address: { street: string; city: string; state: string; zip: string } | null;
      referralSource: string | null;
    }

    const CUSTOMERS: CustomerSeed[] = [
      {
        key: 'aaax',
        type: 'account',
        name: 'AAAX Motor Club Dispatch',
        email: 'dispatch@aaax.example',
        phone: '+18005550100',
        accountKey: 'aaax',
        rateSheetKey: 'aaax',
        address: null,
        referralSource: null,
      },
      {
        key: 'sheetzx',
        type: 'account',
        name: 'SheetzX Fleet Services',
        email: 'fleet@sheetzx.example',
        phone: '+18145550198',
        accountKey: 'sheetzx',
        rateSheetKey: 'sheetzx',
        address: null,
        referralSource: null,
      },
      {
        key: 'marcus',
        type: 'cash',
        name: 'Marcus Johnson',
        email: 'marcus.j.johnson@gmail.example',
        phone: '+16145550112',
        accountKey: null,
        rateSheetKey: null,
        address: { street: '892 Hudson Street', city: 'Columbus', state: 'OH', zip: '43211' },
        referralSource: 'google_ad',
      },
      {
        key: 'cash_2',
        type: 'cash',
        name: 'Latoya Williams',
        email: null,
        phone: '+16145550214',
        accountKey: null,
        rateSheetKey: null,
        address: { street: '3401 East Main Street', city: 'Columbus', state: 'OH', zip: '43213' },
        referralSource: 'walk_in',
      },
      {
        key: 'cash_3',
        type: 'cash',
        name: 'Brandon Schaefer',
        email: 'b.schaefer@yahoo.example',
        phone: '+16145550388',
        accountKey: null,
        rateSheetKey: null,
        address: { street: '5520 Karl Road', city: 'Columbus', state: 'OH', zip: '43229' },
        referralSource: 'referral',
      },
      {
        key: 'cash_4',
        type: 'cash',
        name: 'Aisha Patel',
        email: 'apatel@gmail.example',
        phone: '+16145550457',
        accountKey: null,
        rateSheetKey: null,
        address: { street: '210 South 4th Street', city: 'Columbus', state: 'OH', zip: '43215' },
        referralSource: 'yelp',
      },
      {
        key: 'cash_5_writeoff',
        type: 'cash',
        name: 'Daniel Carver',
        email: null,
        phone: '+16145550621',
        accountKey: null,
        rateSheetKey: null,
        address: { street: '1980 Parsons Avenue', city: 'Columbus', state: 'OH', zip: '43207' },
        referralSource: 'walk_in',
      },
    ];

    const customerIds: Record<string, string> = {};
    for (const c of CUSTOMERS) {
      const id = detId('customer', c.key);
      customerIds[c.key] = id;
      const existing = await db.query.customers.findFirst({ where: eq(schema.customers.id, id) });
      if (existing) continue;
      await db.insert(schema.customers).values({
        id,
        tenantId,
        type: c.type,
        name: c.name,
        email: c.email,
        phone: c.phone,
        accountId: opt(accountIds, c.accountKey),
        defaultRateSheetId: opt(rateSheetIds, c.rateSheetKey),
        homeAddressStreet: c.address?.street ?? null,
        homeAddressCity: c.address?.city ?? null,
        homeAddressState: c.address?.state ?? null,
        homeAddressZip: c.address?.zip ?? null,
        referralSource: c.referralSource,
        createdVia: 'manual',
        createdBy: ownerUserId,
      });
      counts.customers++;
      log(`  inserted customer ${c.name}`);
    }
    counts.customers = CUSTOMERS.length;

    // ──── vehicles + customer_vehicles ───────────────────────────────────
    interface VehicleSeed {
      key: string;
      customerKey: string;
      vin: string;
      plate: string;
      plateState: string;
      year: number;
      make: string;
      model: string;
      color: string;
      vehicleClass: schema.VehicleClass;
    }

    const VEHICLES: VehicleSeed[] = [
      // AAAX members (4)
      {
        key: 'aaax_v1',
        customerKey: 'aaax',
        vin: '1HGCV1F30LA123456',
        plate: 'HXR4521',
        plateState: 'OH',
        year: 2020,
        make: 'Honda',
        model: 'Accord',
        color: 'Silver',
        vehicleClass: 'light_duty',
      },
      {
        key: 'aaax_v2',
        customerKey: 'aaax',
        vin: '5TDKZRFH9HS234567',
        plate: 'JWP8842',
        plateState: 'OH',
        year: 2017,
        make: 'Toyota',
        model: 'Highlander',
        color: 'Black',
        vehicleClass: 'light_duty',
      },
      {
        key: 'aaax_v3',
        customerKey: 'aaax',
        vin: '1FTFW1ET5DKE34567',
        plate: 'KLM3309',
        plateState: 'OH',
        year: 2013,
        make: 'Ford',
        model: 'F-150',
        color: 'Red',
        vehicleClass: 'light_duty',
      },
      {
        key: 'aaax_v4',
        customerKey: 'aaax',
        vin: 'WAUFFAFL3CA445678',
        plate: 'NQT7726',
        plateState: 'OH',
        year: 2012,
        make: 'Audi',
        model: 'A4',
        color: 'White',
        vehicleClass: 'light_duty',
      },
      // SheetzX (3)
      {
        key: 'sheetzx_v1',
        customerKey: 'sheetzx',
        vin: '3GTU2NEC6JG556789',
        plate: 'SHZ1101',
        plateState: 'PA',
        year: 2018,
        make: 'GMC',
        model: 'Sierra 1500',
        color: 'White',
        vehicleClass: 'light_duty',
      },
      {
        key: 'sheetzx_v2',
        customerKey: 'sheetzx',
        vin: '1C4RJEAG8FC667890',
        plate: 'CMR2255',
        plateState: 'OH',
        year: 2015,
        make: 'Jeep',
        model: 'Grand Cherokee',
        color: 'Gray',
        vehicleClass: 'light_duty',
      },
      {
        key: 'sheetzx_v3',
        customerKey: 'sheetzx',
        vin: '1FTBR1Y82MKA77890',
        plate: 'SHZ4422',
        plateState: 'PA',
        year: 2021,
        make: 'Ford',
        model: 'Transit Connect',
        color: 'White',
        vehicleClass: 'commercial',
      },
      // Marcus Johnson — 2019 Honda Accord
      {
        key: 'marcus_v1',
        customerKey: 'marcus',
        vin: '1HGCV1F35KA889012',
        plate: 'OH8842A',
        plateState: 'OH',
        year: 2019,
        make: 'Honda',
        model: 'Accord',
        color: 'Blue',
        vehicleClass: 'light_duty',
      },
      // Other cash customers (1 each)
      {
        key: 'cash_2_v1',
        customerKey: 'cash_2',
        vin: '2T1BURHE7HC990123',
        plate: 'OH7720B',
        plateState: 'OH',
        year: 2017,
        make: 'Toyota',
        model: 'Corolla',
        color: 'Silver',
        vehicleClass: 'light_duty',
      },
      {
        key: 'cash_3_v1',
        customerKey: 'cash_3',
        vin: 'KMHCT4AE8DU101234',
        plate: 'OH4451C',
        plateState: 'OH',
        year: 2013,
        make: 'Hyundai',
        model: 'Accent',
        color: 'Black',
        vehicleClass: 'light_duty',
      },
      {
        key: 'cash_4_v1',
        customerKey: 'cash_4',
        vin: '3FA6P0HD5GR212345',
        plate: 'OH9920D',
        plateState: 'OH',
        year: 2016,
        make: 'Ford',
        model: 'Fusion',
        color: 'Red',
        vehicleClass: 'light_duty',
      },
      {
        key: 'cash_5_writeoff_v1',
        customerKey: 'cash_5_writeoff',
        vin: '1G1ZD5ST9KF323456',
        plate: 'OH3308E',
        plateState: 'OH',
        year: 2019,
        make: 'Chevrolet',
        model: 'Malibu',
        color: 'White',
        vehicleClass: 'light_duty',
      },
    ];

    const vehicleIds: Record<string, string> = {};
    for (const v of VEHICLES) {
      const id = detId('vehicle', v.key);
      vehicleIds[v.key] = id;
      const existing = await db.query.vehicles.findFirst({ where: eq(schema.vehicles.id, id) });
      if (existing) continue;
      const customerId = req(customerIds, v.customerKey, `customer ${v.customerKey}`);
      await db.insert(schema.vehicles).values({
        id,
        tenantId,
        vin: v.vin,
        plate: v.plate,
        plateState: v.plateState,
        year: v.year,
        make: v.make,
        model: v.model,
        color: v.color,
        vehicleClass: v.vehicleClass,
        defaultCustomerId: customerId,
        createdBy: ownerUserId,
      });
      counts.vehicles++;
      // customer_vehicles link.
      const linkId = detId('customer_vehicle', `${v.customerKey}:${v.key}`);
      await db.insert(schema.customerVehicles).values({
        id: linkId,
        tenantId,
        customerId,
        vehicleId: id,
        relationship: 'owner',
        isPrimary: true,
      });
      counts.customerVehicles++;
    }
    counts.vehicles = VEHICLES.length;
    counts.customerVehicles = VEHICLES.length;

    // ──── trucks ─────────────────────────────────────────────────────────
    const truckIds: Record<string, string> = {};
    for (const t of TRUCKS) {
      const id = detId('truck', t.unit);
      truckIds[t.unit] = id;
      const existing = await db.query.trucks.findFirst({ where: eq(schema.trucks.id, id) });
      if (existing) continue;
      const yardName = YARDS.find((y) => y.key === t.yardKey)?.name ?? '';
      await db.insert(schema.trucks).values({
        id,
        tenantId,
        unitNumber: t.unit,
        truckType: t.type,
        capacityClass: t.capacity,
        year: t.year,
        make: t.make,
        model: t.model,
        vin: t.vin,
        plate: t.plate,
        plateState: 'OH',
        fuelType: t.fuel,
        equipment: t.equipment,
        teslaCertified: false,
        aaaFlatbed: t.type === 'flatbed' && t.capacity === 'light',
        heavyDutyCapable: t.capacity === 'heavy' || t.capacity === 'HD',
        currentOdometer: 50_000 + Number.parseInt(t.unit, 10) * 137,
        odometerUpdatedAt: daysAgo(2, now),
        status: 'active',
        inService: true,
        notes: `Yard: ${yardName}`,
        createdBy: ownerUserId,
      });
      counts.trucks++;
      log(`  inserted truck ${t.unit} (${yardName})`);
    }
    counts.trucks = TRUCKS.length;

    // ──── drivers ────────────────────────────────────────────────────────
    const driverIds: Record<string, string> = {};
    for (const d of DRIVERS) {
      const id = detId('driver', d.empNum);
      driverIds[d.key] = id;
      const existing = await db.query.drivers.findFirst({ where: eq(schema.drivers.id, id) });
      if (existing) continue;
      await db.insert(schema.drivers).values({
        id,
        tenantId,
        userId: opt(userIds, d.userKey),
        employeeNumber: d.empNum,
        firstName: d.firstName,
        lastName: d.lastName,
        phone: `+1614555${8000 + Number.parseInt(d.empNum.slice(-2), 10)}`,
        email: USERS.find((u) => u.key === d.userKey)?.email ?? null,
        cdlClass: d.cdl,
        cdlExpiresAt: '2028-06-30',
        licenseState: 'OH',
        licenseExpiresAt: '2028-06-30',
        medicalCardExpiresAt: '2027-03-15',
        hiredAt: '2024-01-15',
        employmentStatus: 'active',
        assignedYardId: detId('yard', d.yardKey),
        active: true,
        createdBy: ownerUserId,
      });
      counts.drivers++;
      log(`  inserted driver ${d.firstName} ${d.lastName}`);
    }
    counts.drivers = DRIVERS.length;

    // ──── driver_truck_assignments ───────────────────────────────────────
    for (const t of TRUCKS) {
      if (!t.primaryDriverKey) continue;
      const linkId = detId('driver_truck', `${t.primaryDriverKey}:${t.unit}`);
      const existing = await db.query.driverTruckAssignments.findFirst({
        where: eq(schema.driverTruckAssignments.id, linkId),
      });
      if (existing) continue;
      await db.insert(schema.driverTruckAssignments).values({
        id: linkId,
        tenantId,
        driverId: req(driverIds, t.primaryDriverKey, `driver ${t.primaryDriverKey}`),
        truckId: req(truckIds, t.unit, `truck ${t.unit}`),
        isPrimary: true,
        createdBy: ownerUserId,
      });
      counts.driverTruckAssignments++;
    }

    // ──── driver_shifts ──────────────────────────────────────────────────
    // One active shift per driver, paired with their primary truck. We'll
    // adjust two of them (drv_4 on Job 6 on_scene; drv_2 on Job 7 en_route)
    // after the jobs are inserted.
    for (const d of DRIVERS) {
      const id = detId('shift', d.empNum);
      const primaryTruck = TRUCKS.find((t) => t.primaryDriverKey === d.key);
      const existing = await db.query.driverShifts.findFirst({
        where: eq(schema.driverShifts.id, id),
      });
      if (existing) continue;
      await db.insert(schema.driverShifts).values({
        id,
        tenantId,
        driverId: req(driverIds, d.key, `driver ${d.key}`),
        truckId: primaryTruck ? opt(truckIds, primaryTruck.unit) : null,
        status: 'available',
        startedAt: hoursAgo(6, now),
        createdBy: ownerUserId,
      });
      counts.driverShifts++;
    }

    // ────────────────────────────────────────────────────────────────────
    // Jobs + invoices + payments
    // ────────────────────────────────────────────────────────────────────

    // Helper: allocate next invoice number (ROAD-2026-NNNNN) via the
    // invoice_number_sequences table. UPSERT + RETURNING is atomic.
    async function nextInvoiceNumber(): Promise<string> {
      const result = await db.execute<{ last_seq: number }>(sql`
        INSERT INTO invoice_number_sequences (tenant_id, year_key, last_seq, updated_at)
        VALUES (${tenantId}, ${INVOICE_YEAR}, 1, now())
        ON CONFLICT (tenant_id, year_key) DO UPDATE
          SET last_seq = invoice_number_sequences.last_seq + 1,
              updated_at = now()
        RETURNING last_seq
      `);
      const seq = Number(result.rows[0]?.last_seq ?? 0);
      return `${INVOICE_PREFIX}-${INVOICE_YEAR}-${seq.toString().padStart(5, '0')}`;
    }

    // Helper: allocate next job number (YYYYMMDD-NNNN) for a given day.
    async function nextJobNumber(day: Date): Promise<string> {
      const dayKey =
        day.getUTCFullYear().toString() +
        (day.getUTCMonth() + 1).toString().padStart(2, '0') +
        day.getUTCDate().toString().padStart(2, '0');
      const result = await db.execute<{ last_seq: number }>(sql`
        INSERT INTO job_number_sequences (tenant_id, day_key, last_seq, updated_at)
        VALUES (${tenantId}, ${dayKey}, 1, now())
        ON CONFLICT (tenant_id, day_key) DO UPDATE
          SET last_seq = job_number_sequences.last_seq + 1,
              updated_at = now()
        RETURNING last_seq
      `);
      const seq = Number(result.rows[0]?.last_seq ?? 0);
      return `${dayKey}-${seq.toString().padStart(4, '0')}`;
    }

    interface LineSpec {
      lineType: schema.InvoiceLineItemType;
      description: string;
      quantity: string; // numeric string to preserve precision
      unit: string;
      unitPriceCents: number;
      taxable: boolean;
    }

    interface JobSpec {
      key: string;
      day: Date; // for job_number_sequences allocation
      createdAt: Date;
      status: schema.JobStatus;
      serviceType: schema.JobServiceType;
      customerKey: string;
      vehicleKey: string;
      accountKey?: 'aaax' | 'sheetzx' | null;
      pickupAddress: string;
      pickupLat?: string;
      pickupLng?: string;
      dropoffAddress?: string;
      authorizedBy: schema.JobAuthorizedBy;
      authorizedByName?: string;
      driverKey?: string;
      truckUnit?: string;
      assignedAt?: Date;
      rateQuotedCents: number;
      notes?: string;
    }

    interface InvoiceSpec {
      jobKey: string | null; // null for the write-off historical invoice
      invoiceType: schema.InvoiceType;
      status: schema.InvoiceStatus;
      customerKey: string;
      accountKey?: 'aaax' | 'sheetzx' | null;
      rateSheetKey: 'default' | 'aaax' | 'sheetzx';
      terms: schema.InvoiceTerms;
      issuedAt?: Date;
      dueAt?: Date;
      paidAt?: Date;
      lines: LineSpec[];
      payments: Array<{
        amountCents: number;
        paymentMethod: schema.PaymentMethod;
        referenceNumber?: string;
        receivedAt: Date;
        notes?: string;
      }>;
      placeholderPdf: boolean;
    }

    // Build the eight jobs and (where present) their invoices in one pass.
    const JOBS: JobSpec[] = [
      // Job 1 — completed 25 days ago, AAAX motor club tow, paid
      {
        key: 'job1',
        day: daysAgo(25, now),
        createdAt: daysAgo(25, now),
        status: 'completed',
        serviceType: 'tow',
        customerKey: 'aaax',
        vehicleKey: 'aaax_v1',
        accountKey: 'aaax',
        pickupAddress: 'I-71 NB MM 109, Columbus, OH 43229',
        dropoffAddress: 'Honda of Easton, 4116 Morse Crossing, Columbus, OH 43219',
        authorizedBy: 'motor_club',
        authorizedByName: 'AAAX dispatch case #AX-882134',
        driverKey: 'drv_1',
        truckUnit: '101',
        assignedAt: daysAgo(25, now),
        rateQuotedCents: 15900,
        notes:
          'AAAX dispatch case #AX-882134. Photos uploaded (4); customer signature captured at dropoff.',
      },
      // Job 2 — 48 days ago, AAAX, 22 mi after-hours flagged, status=sent (overdue)
      {
        key: 'job2',
        day: daysAgo(48, now),
        createdAt: daysAgo(48, now),
        status: 'completed',
        serviceType: 'tow',
        customerKey: 'aaax',
        vehicleKey: 'aaax_v2',
        accountKey: 'aaax',
        pickupAddress: 'I-270 EB MM 33, Dublin, OH 43017',
        dropoffAddress: 'Member residence: 2885 Cleveland Ave, Columbus, OH 43211',
        authorizedBy: 'motor_club',
        authorizedByName: 'AAAX dispatch case #AX-880221',
        driverKey: 'drv_2',
        truckUnit: '102',
        assignedAt: daysAgo(48, now),
        rateQuotedCents: 18700,
        notes:
          'AAAX dispatch case #AX-880221. After-hours pickup at 23:14 — no surcharge per AAAX contract.',
      },
      // Job 3 — 18 days ago, SheetzX light tow 8 mi, paid 10d ago
      {
        key: 'job3',
        day: daysAgo(18, now),
        createdAt: daysAgo(18, now),
        status: 'completed',
        serviceType: 'tow',
        customerKey: 'sheetzx',
        vehicleKey: 'sheetzx_v1',
        accountKey: 'sheetzx',
        pickupAddress: 'Sheetz #487, 2855 Stelzer Rd, Columbus, OH 43219',
        dropoffAddress: 'Main Yard — Columbus impound, 1450 Joyce Ave, Columbus, OH 43219',
        authorizedBy: 'account_contact',
        authorizedByName: 'Sheetz #487 SM (G. Tomlin)',
        driverKey: 'drv_3',
        truckUnit: '103',
        assignedAt: daysAgo(18, now),
        rateQuotedCents: 18445,
      },
      // Job 4 — 12 days ago, SheetzX, medium tow 18 mi + wait 30 min, partial paid
      {
        key: 'job4',
        day: daysAgo(12, now),
        createdAt: daysAgo(12, now),
        status: 'completed',
        serviceType: 'tow',
        customerKey: 'sheetzx',
        vehicleKey: 'sheetzx_v3',
        accountKey: 'sheetzx',
        pickupAddress: 'Sheetz #221, 1880 N High St, Columbus, OH 43201',
        dropoffAddress: 'SheetzX Service Center, 1015 Refugee Rd, Columbus, OH 43207',
        authorizedBy: 'account_contact',
        authorizedByName: 'Sheetz #221 SM (G. Tomlin)',
        driverKey: 'drv_4',
        truckUnit: '107',
        assignedAt: daysAgo(12, now),
        rateQuotedCents: 32880,
        notes: '30 minutes wait time at scene (15 min over grace).',
      },
      // Job 5 — Marcus Johnson, cash, paid in full at scene 3 days ago
      {
        key: 'job5',
        day: daysAgo(3, now),
        createdAt: daysAgo(3, now),
        status: 'completed',
        serviceType: 'tow',
        customerKey: 'marcus',
        vehicleKey: 'marcus_v1',
        accountKey: null,
        pickupAddress: '892 Hudson St, Columbus, OH 43211',
        dropoffAddress: 'Honda of Hilliard, 3700 Walden Rd, Hilliard, OH 43026',
        authorizedBy: 'customer',
        authorizedByName: 'Marcus Johnson',
        driverKey: 'drv_5',
        truckUnit: '105',
        assignedAt: daysAgo(3, now),
        rateQuotedCents: 42900,
        notes: 'Cash retail (google_ad referral). Card swiped at scene.',
      },
      // Job 6 — AAAX open, on_scene (35 min ago dispatched, on_scene 12 min ago)
      {
        key: 'job6',
        day: now,
        createdAt: minutesAgo(35, now),
        status: 'on_scene',
        serviceType: 'tow',
        customerKey: 'aaax',
        vehicleKey: 'aaax_v3',
        accountKey: 'aaax',
        pickupAddress: 'I-70 EB MM 99, Columbus, OH 43223',
        dropoffAddress: 'Member residence: 1240 N Hague Ave, Columbus, OH 43204',
        authorizedBy: 'motor_club',
        authorizedByName: 'AAAX dispatch case #AX-901456',
        driverKey: 'drv_4',
        truckUnit: '107',
        assignedAt: minutesAgo(34, now),
        rateQuotedCents: 17400,
        notes: 'AAAX dispatch case #AX-901456. Driver on scene at 12 min mark.',
      },
      // Job 7 — SheetzX open, en_route (8 min ago dispatched, ETA 22 min)
      {
        key: 'job7',
        day: now,
        createdAt: minutesAgo(8, now),
        status: 'enroute',
        serviceType: 'tow',
        customerKey: 'sheetzx',
        vehicleKey: 'sheetzx_v2',
        accountKey: 'sheetzx',
        pickupAddress: 'Sheetz #305, 5440 N High St, Columbus, OH 43214',
        dropoffAddress: 'SheetzX Service Center, 1015 Refugee Rd, Columbus, OH 43207',
        authorizedBy: 'account_contact',
        authorizedByName: 'Sheetz #305 SM (G. Tomlin)',
        driverKey: 'drv_2',
        truckUnit: '102',
        assignedAt: minutesAgo(7, now),
        rateQuotedCents: 18445,
        notes: 'ETA 22 min from dispatch.',
      },
      // Job 8 — small cash customer, completed yesterday, invoice = draft
      {
        key: 'job8',
        day: daysAgo(1, now),
        createdAt: daysAgo(1, now),
        status: 'completed',
        serviceType: 'tow',
        customerKey: 'cash_3',
        vehicleKey: 'cash_3_v1',
        accountKey: null,
        pickupAddress: '5520 Karl Rd, Columbus, OH 43229',
        dropoffAddress: 'Hyundai of South Columbus, 4200 S High St, Columbus, OH 43207',
        authorizedBy: 'customer',
        authorizedByName: 'Brandon Schaefer',
        driverKey: 'drv_6',
        truckUnit: '111',
        assignedAt: daysAgo(1, now),
        rateQuotedCents: 22900,
        notes: 'Completed job awaiting invoice review.',
      },
    ];

    const jobIds: Record<string, string> = {};
    for (const j of JOBS) {
      const id = detId('job', j.key);
      jobIds[j.key] = id;
      const existing = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
      if (existing) continue;
      const jobNumber = await nextJobNumber(j.day);
      await db.insert(schema.jobs).values({
        id,
        tenantId,
        jobNumber,
        status: j.status,
        serviceType: j.serviceType,
        customerId: req(customerIds, j.customerKey, `customer ${j.customerKey}`),
        vehicleId: req(vehicleIds, j.vehicleKey, `vehicle ${j.vehicleKey}`),
        accountId: opt(accountIds, j.accountKey ?? null),
        pickupAddress: j.pickupAddress,
        pickupLat: j.pickupLat ?? null,
        pickupLng: j.pickupLng ?? null,
        dropoffAddress: j.dropoffAddress ?? null,
        authorizedBy: j.authorizedBy,
        authorizedByName: j.authorizedByName ?? null,
        assignedDriverId: opt(driverIds, j.driverKey),
        assignedTruckId: opt(truckIds, j.truckUnit),
        assignedShiftId: j.driverKey
          ? detId('shift', DRIVERS.find((d) => d.key === j.driverKey)?.empNum ?? '')
          : null,
        assignedAt: j.assignedAt ?? null,
        rateQuotedCents: j.rateQuotedCents,
        notes: j.notes ?? null,
        createdByUserId: ownerUserId,
        createdAt: j.createdAt,
        updatedAt: j.createdAt,
      });
      counts.jobs++;
      log(`  inserted job ${j.key} (${jobNumber}, ${j.status})`);
    }

    // Adjust driver shifts to reflect in-flight jobs 6 and 7.
    const job6Id = req(jobIds, 'job6', 'job6');
    const job7Id = req(jobIds, 'job7', 'job7');
    await db
      .update(schema.driverShifts)
      .set({ status: 'on_scene', currentJobId: job6Id })
      .where(eq(schema.driverShifts.id, detId('shift', 'R-D04')));
    await db
      .update(schema.driverShifts)
      .set({ status: 'en_route', currentJobId: job7Id })
      .where(eq(schema.driverShifts.id, detId('shift', 'R-D02')));

    // ──── invoices ───────────────────────────────────────────────────────

    const INVOICES: InvoiceSpec[] = [
      // Inv 1 — Job 1 (paid)
      {
        jobKey: 'job1',
        invoiceType: 'motor_club_submission',
        status: 'paid',
        customerKey: 'aaax',
        accountKey: 'aaax',
        rateSheetKey: 'aaax',
        terms: 'net_45',
        issuedAt: daysAgo(25, now),
        dueAt: daysAgo(25 - 45, now),
        paidAt: daysAgo(5, now),
        lines: [
          {
            lineType: 'service',
            description: 'Light-duty tow base (AAAX contract)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 8500,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage (AAAX contract)',
            quantity: '14',
            unit: 'mile',
            unitPriceCents: 350,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2500,
            taxable: false,
          },
        ],
        payments: [
          {
            amountCents: 15900,
            paymentMethod: 'motor_club_remittance',
            referenceNumber: 'AAAX-REM-20250420',
            receivedAt: daysAgo(5, now),
            notes: 'ACH remittance batch AAAX-REM-20250420.',
          },
        ],
        placeholderPdf: true,
      },
      // Inv 2 — Job 2 (sent, aged 47 days — past Net 45 by 2 days)
      {
        jobKey: 'job2',
        invoiceType: 'motor_club_submission',
        status: 'sent',
        customerKey: 'aaax',
        accountKey: 'aaax',
        rateSheetKey: 'aaax',
        terms: 'net_45',
        issuedAt: daysAgo(47, now),
        dueAt: daysAgo(2, now),
        lines: [
          {
            lineType: 'service',
            description: 'Light-duty tow base (AAAX contract)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 8500,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage (AAAX contract)',
            quantity: '22',
            unit: 'mile',
            unitPriceCents: 350,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2500,
            taxable: false,
          },
        ],
        payments: [],
        placeholderPdf: true,
      },
      // Inv 3 — Job 3 (paid)
      {
        jobKey: 'job3',
        invoiceType: 'account_invoice',
        status: 'paid',
        customerKey: 'sheetzx',
        accountKey: 'sheetzx',
        rateSheetKey: 'sheetzx',
        terms: 'net_30',
        issuedAt: daysAgo(17, now),
        dueAt: daysAgo(17 - 30, now),
        paidAt: daysAgo(10, now),
        lines: [
          {
            lineType: 'service',
            description: 'Light-duty tow base (SheetzX -15%)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 10625,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage (SheetzX -15%)',
            quantity: '8',
            unit: 'mile',
            unitPriceCents: 340,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee (SheetzX -15%)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2125,
            taxable: false,
          },
          {
            lineType: 'admin',
            description: 'Admin fee (SheetzX -15%)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2975,
            taxable: false,
          },
        ],
        payments: [
          {
            amountCents: 18445,
            paymentMethod: 'ach',
            referenceNumber: 'ACH-SHZ-20250428',
            receivedAt: daysAgo(10, now),
            notes: 'ACH from SheetzX corporate.',
          },
        ],
        placeholderPdf: true,
      },
      // Inv 4 — Job 4 (partially_paid, 50% paid 5 days ago)
      {
        jobKey: 'job4',
        invoiceType: 'account_invoice',
        status: 'partially_paid',
        customerKey: 'sheetzx',
        accountKey: 'sheetzx',
        rateSheetKey: 'sheetzx',
        terms: 'net_30',
        issuedAt: daysAgo(11, now),
        dueAt: daysAgo(11 - 30, now),
        lines: [
          {
            lineType: 'service',
            description: 'Medium-duty tow base (SheetzX -15%)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 17000,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage medium (SheetzX -15%)',
            quantity: '18',
            unit: 'mile',
            unitPriceCents: 510,
            taxable: false,
          },
          {
            lineType: 'wait_time',
            description: 'Wait time past 15-min grace (SheetzX -15%)',
            quantity: '0.25',
            unit: 'hour',
            unitPriceCents: 6375,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee (SheetzX -15%)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2125,
            taxable: false,
          },
          {
            lineType: 'admin',
            description: 'Admin fee (SheetzX -15%)',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2975,
            taxable: false,
          },
        ],
        payments: [
          {
            amountCents: 16440, // 50% rounded to nearest cent
            paymentMethod: 'ach',
            referenceNumber: 'ACH-SHZ-20250505',
            receivedAt: daysAgo(5, now),
            notes: 'Partial payment — balance pending net-30 cycle.',
          },
        ],
        placeholderPdf: true,
      },
      // Inv 5 — Job 5 (Marcus, cash receipt, paid in full at scene)
      {
        jobKey: 'job5',
        invoiceType: 'cash_receipt',
        status: 'paid',
        customerKey: 'marcus',
        accountKey: null,
        rateSheetKey: 'default',
        terms: 'due_on_receipt',
        issuedAt: daysAgo(3, now),
        dueAt: daysAgo(3, now),
        paidAt: daysAgo(3, now),
        lines: [
          {
            lineType: 'service',
            description: 'Light-duty tow base',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 12500,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage',
            quantity: '6',
            unit: 'mile',
            unitPriceCents: 400,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2500,
            taxable: false,
          },
          {
            lineType: 'admin',
            description: 'Admin fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 3500,
            taxable: false,
          },
        ],
        payments: [
          {
            amountCents: 42900,
            paymentMethod: 'credit_card',
            referenceNumber: 'last4:4242',
            receivedAt: daysAgo(3, now),
            notes: 'Card swiped at scene by driver.',
          },
        ],
        placeholderPdf: true,
      },
      // Inv 6 — Job 8 (draft, auto-generated from completed job)
      {
        jobKey: 'job8',
        invoiceType: 'cash_receipt',
        status: 'draft',
        customerKey: 'cash_3',
        accountKey: null,
        rateSheetKey: 'default',
        terms: 'due_on_receipt',
        lines: [
          {
            lineType: 'service',
            description: 'Light-duty tow base',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 12500,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage',
            quantity: '11',
            unit: 'mile',
            unitPriceCents: 400,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2500,
            taxable: false,
          },
          {
            lineType: 'admin',
            description: 'Admin fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 3500,
            taxable: false,
          },
        ],
        payments: [],
        placeholderPdf: false,
      },
      // Inv 7 — Historical write-off, 90 days old
      {
        jobKey: null,
        invoiceType: 'cash_receipt',
        status: 'paid', // balance is 0 after write_off payment
        customerKey: 'cash_5_writeoff',
        accountKey: null,
        rateSheetKey: 'default',
        terms: 'due_on_receipt',
        issuedAt: daysAgo(90, now),
        dueAt: daysAgo(90, now),
        paidAt: daysAgo(5, now),
        lines: [
          {
            lineType: 'service',
            description: 'Light-duty tow base',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 12500,
            taxable: false,
          },
          {
            lineType: 'mileage_loaded',
            description: 'Loaded mileage',
            quantity: '8',
            unit: 'mile',
            unitPriceCents: 400,
            taxable: false,
          },
          {
            lineType: 'environmental',
            description: 'Environmental fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 2500,
            taxable: false,
          },
          {
            lineType: 'admin',
            description: 'Admin fee',
            quantity: '1',
            unit: 'each',
            unitPriceCents: 3500,
            taxable: false,
          },
        ],
        payments: [
          {
            amountCents: 21700,
            paymentMethod: 'write_off',
            referenceNumber: 'WO-202602-001',
            receivedAt: daysAgo(5, now),
            notes: 'Customer unreachable, sent to collections, written off per policy.',
          },
        ],
        placeholderPdf: true,
      },
    ];

    for (const inv of INVOICES) {
      const invoiceId = detId('invoice', inv.jobKey ?? `writeoff:${inv.customerKey}`);
      const existing = await db.query.invoices.findFirst({
        where: eq(schema.invoices.id, invoiceId),
      });
      if (existing) continue;

      const subtotal = inv.lines.reduce(
        (acc, l) => acc + Math.round(Number(l.quantity) * l.unitPriceCents),
        0,
      );
      // All seeded jobs are tow-only — no taxable lines under OH rules, so tax = 0.
      const tax = inv.lines.reduce(
        (acc, l) =>
          acc + (l.taxable ? Math.round(Number(l.quantity) * l.unitPriceCents * 0.0725) : 0),
        0,
      );
      const total = subtotal + tax;
      const paid = inv.payments.reduce((acc, p) => acc + p.amountCents, 0);
      const balance = total - paid;

      const invoiceNumber = await nextInvoiceNumber();

      await db.insert(schema.invoices).values({
        id: invoiceId,
        tenantId,
        invoiceNumber,
        invoiceType: inv.invoiceType,
        status: inv.status,
        customerId: req(customerIds, inv.customerKey, `customer ${inv.customerKey}`),
        accountId: opt(accountIds, inv.accountKey ?? null),
        jobId: opt(jobIds, inv.jobKey),
        rateSheetId: req(rateSheetIds, inv.rateSheetKey, `rate sheet ${inv.rateSheetKey}`),
        issuedAt: inv.issuedAt ?? null,
        dueAt: inv.dueAt ?? null,
        paidAt: inv.paidAt ?? null,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        paidCents: paid,
        balanceCents: balance,
        currency: 'USD',
        terms: inv.terms,
        notes: inv.placeholderPdf ? 'PDF placeholder — generate via billing module export.' : null,
        billingAddress: inv.accountKey
          ? (ACCOUNTS.find((a) => a.key === inv.accountKey)?.address ?? null)
          : (CUSTOMERS.find((c) => c.key === inv.customerKey)?.address ?? null),
        paymentToken:
          inv.invoiceType === 'cash_receipt' && inv.status !== 'draft'
            ? `pay_${detId('paytoken', invoiceNumber).slice(0, 24)}`
            : null,
        createdBy: ownerUserId,
        createdAt: inv.issuedAt ?? now,
        updatedAt: inv.issuedAt ?? now,
      });
      counts.invoices++;

      for (let i = 0; i < inv.lines.length; i++) {
        const line = inv.lines[i];
        if (!line) continue;
        const lineTotal = Math.round(Number(line.quantity) * line.unitPriceCents);
        await db.insert(schema.invoiceLineItems).values({
          id: detId('invoice_line', `${invoiceId}:${i + 1}`),
          tenantId,
          invoiceId,
          lineNumber: i + 1,
          lineType: line.lineType,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          lineTotalCents: lineTotal,
          taxable: line.taxable,
          taxRatePct: line.taxable ? '7.2500' : '0',
        });
        counts.invoiceLineItems++;
      }

      for (let i = 0; i < inv.payments.length; i++) {
        const p = inv.payments[i];
        if (!p) continue;
        await db.insert(schema.payments).values({
          id: detId('payment', `${invoiceId}:${i + 1}`),
          tenantId,
          invoiceId,
          amountCents: p.amountCents,
          paymentMethod: p.paymentMethod,
          referenceNumber: p.referenceNumber ?? null,
          receivedAt: p.receivedAt,
          recordedBy: ownerUserId,
          status: 'cleared',
          notes: p.notes ?? null,
        });
        counts.payments++;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST_SEED_REPORT.md (written at the repo root for the founder demo)
    // ─────────────────────────────────────────────────────────────────────
    const reportPath = join(process.cwd(), 'POST_SEED_REPORT.md');
    const report = renderReport(args.target, counts, now);
    writeFileSync(reportPath, report, 'utf8');
    log(`wrote ${reportPath}`);

    log('done');
    log(`tenant=${TENANT_SLUG} owner=chris@roadside.demo password=${DEMO_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

function renderReport(target: Target, c: Counts, now: Date): string {
  const ts = now.toISOString();
  return `# Roadside Towing & Recovery — Demo Seed Report

Generated: ${ts}
Target: \`${target}\`
Tenant slug: \`${TENANT_SLUG}\`

## Login

- URL: https://app.towdispatch.cloud
- Email: \`chris@roadside.demo\`
- Password: \`${DEMO_PASSWORD}\`  (force rotation on first login — lastLoginAt is NULL on every seeded user)

All non-owner users seeded with the same password and the same null lastLoginAt; the app's first-login flow routes them through a forced password change.

## Seed counts

| Entity                  | Count |
|-------------------------|------:|
| tenants                 | ${c.tenants} |
| yards (in tenant.settings) | ${c.yards} |
| users                   | ${c.users} |
| drivers                 | ${c.drivers} |
| trucks                  | ${c.trucks} |
| driver_truck_assignments| ${c.driverTruckAssignments} |
| driver_shifts (open)    | ${c.driverShifts} |
| rate_sheets             | ${c.rateSheets} |
| accounts                | ${c.accounts} |
| customers               | ${c.customers} |
| vehicles                | ${c.vehicles} |
| customer_vehicles       | ${c.customerVehicles} |
| jobs                    | ${c.jobs} |
| invoices                | ${c.invoices} |
| invoice_line_items      | ${c.invoiceLineItems} |
| payments                | ${c.payments} |

## Walkthrough URL list

Open the following in order to show every dataset state:

- Open jobs: <https://app.towdispatch.cloud/jobs?status=open>
- Completed jobs awaiting invoice: <https://app.towdispatch.cloud/jobs?status=completed&invoice=none>
- Draft invoices: <https://app.towdispatch.cloud/billing/invoices?status=draft>
- Sent / aged invoices: <https://app.towdispatch.cloud/billing/invoices?status=sent>
- Partially paid invoices: <https://app.towdispatch.cloud/billing/invoices?status=partially_paid>
- Paid invoices: <https://app.towdispatch.cloud/billing/invoices?status=paid>
- Write-offs: <https://app.towdispatch.cloud/billing/adjustments?kind=write_off>
- A/R aging: <https://app.towdispatch.cloud/billing/aging>
- Rate sheets: <https://app.towdispatch.cloud/billing/rate-sheets>

Several of these routes do not exist yet in the web app (no \`/billing/adjustments\`, no \`/billing/aging\`, no \`/billing/rate-sheets\`, and the \`?invoice=none\` filter on \`/jobs\` is not implemented). **Needed in Session 10.**

## What the eight jobs demonstrate

1. \`job1\` — AAAX motor club tow, **completed 25 days ago, paid 5 days ago via ACH**. Headline "happy path" for motor club billing.
2. \`job2\` — AAAX, **completed 48 days ago, invoice sent (aged 47 days — 2 days past Net 45)**. A/R aging demo.
3. \`job3\` — SheetzX commercial, completed 18 days ago, **paid 10 days ago via ACH**.
4. \`job4\` — SheetzX commercial, completed 12 days ago, **partially paid (50%)** 5 days ago — balance remains.
5. \`job5\` — Marcus Johnson cash retail (\`referral_source = google_ad\`), **paid in full at scene** via card.
6. \`job6\` — AAAX, **open, on_scene** (dispatched 35 min ago, on scene 12 min ago) — no invoice yet.
7. \`job7\` — SheetzX, **open, en_route** (dispatched 8 min ago, ETA 22 min) — no invoice yet.
8. \`job8\` — small cash, completed yesterday, **invoice = DRAFT** (auto-generated, awaiting review).

Plus one historical write-off invoice (90 days old, cash customer Daniel Carver, \`$217.00\` written off, reason "Customer unreachable, sent to collections, written off per policy"). Surfaces on \`/billing/adjustments?kind=write_off\`.

## Verification (post-run)

\`\`\`sql
SELECT name FROM tenants WHERE slug = 'roadside';
SELECT count(*) FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'roadside');
SELECT count(*) FROM trucks WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'roadside');
SELECT count(*) FROM jobs WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'roadside');
SELECT status, count(*) FROM invoices WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'roadside') GROUP BY status ORDER BY status;
SELECT payment_method, count(*) FROM payments WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'roadside') GROUP BY payment_method;
\`\`\`

## Re-running

- \`pnpm db:seed:demo --target=local\` — idempotent (deterministic IDs).
- \`pnpm db:seed:demo --target=local --reset\` — wipe the demo tenant first, then re-seed.
- \`SEED_DEMO_CONFIRM=YES_I_AM_SURE pnpm db:seed:demo --target=production --reset\` — production with a fresh demo tenant.
`;
}

main().catch((err) => {
  process.stderr.write(`[seed-demo] FAILED: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
