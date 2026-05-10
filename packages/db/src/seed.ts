/**
 * Idempotent dev seed.
 * Creates 2 tenants — Acme Towing (acme), Metro Recovery (metro) — and 3 users
 * each (owner / dispatcher / driver). All passwords: ChangeMe123!
 *
 * For each tenant we also seed:
 *   - 1 motor club account (Agero)
 *   - 1 commercial account (Acme Logistics, net-30)
 *   - 4 cash customers
 *   - 6 vehicles (mix of light-duty cars, one heavy-duty truck, one EV)
 *   - customer_vehicles links connecting the customers to their vehicles
 *
 * Connects with DATABASE_ADMIN_URL because seeding tenants requires INSERT on
 * the tenants table, which has no INSERT RLS policy by design.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
const { Pool } = pg;
import * as schema from './schema/index';
import { uuidv7 } from './uuid';

const SEED_PASSWORD = 'ChangeMe123!';

/**
 * Pricing modeled on a typical small/mid-market towing rate card. Tow has a
 * $95 hookup + $4.50/mi for light-duty; medium/heavy bump higher. Lighter
 * services are flat fees. After-hours surcharge $35 between 22:00–06:00.
 * Admin fee $5 is always-on. Edit through tenant settings once the UI exists.
 */
const DEFAULT_RATE_SHEET_DEFINITION = {
  version: 1 as const,
  currency: 'USD' as const,
  freeMilesIncluded: 5,
  services: [
    {
      serviceType: 'tow' as const,
      baseCents: 9500,
      perMileCentsByClass: {
        light_duty: 450,
        medium_duty: 700,
        heavy_duty: 1100,
        motorcycle: 450,
        commercial: 900,
        rv: 800,
        unknown: 450,
      },
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
    {
      serviceType: 'fuel' as const,
      baseCents: 7500,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'winch' as const,
      baseCents: 15000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
    {
      serviceType: 'recovery' as const,
      baseCents: 25000,
      perMileCentsByClass: {
        light_duty: 600,
        medium_duty: 900,
        heavy_duty: 1500,
        motorcycle: 600,
        commercial: 1200,
        rv: 1200,
        unknown: 600,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'impound' as const,
      baseCents: 12500,
      perMileCentsByClass: {
        light_duty: 450,
        medium_duty: 700,
        heavy_duty: 1100,
        motorcycle: 450,
        commercial: 900,
        rv: 800,
        unknown: 450,
      },
      flatFeesByClass: {},
    },
    {
      serviceType: 'other' as const,
      baseCents: 10000,
      perMileCentsByClass: {},
      flatFeesByClass: {},
    },
  ],
  surcharges: [
    {
      code: 'after_hours',
      label: 'After-hours surcharge',
      startHHmm: '22:00',
      endHHmm: '06:00',
      crossesMidnight: true,
      amountCents: 3500,
      daysOfWeek: [],
    },
  ],
  fixedLineItems: [{ code: 'admin_fee', label: 'Admin fee', amountCents: 500 }],
};

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error('DATABASE_ADMIN_URL is required to run seed');
}

const log = (msg: string): void => {
  process.stdout.write(`[seed] ${msg}\n`);
};

interface SeedTenant {
  slug: string;
  name: string;
  users: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: schema.UserRole;
  }>;
}

const SEED_DATA: SeedTenant[] = [
  {
    slug: 'acme',
    name: 'Acme Towing',
    users: [
      { email: 'owner@acme.test', firstName: 'Adam', lastName: 'Acme', role: 'owner' },
      {
        email: 'dispatcher@acme.test',
        firstName: 'Dana',
        lastName: 'Dispatch',
        role: 'dispatcher',
      },
      { email: 'driver@acme.test', firstName: 'Drew', lastName: 'Driver', role: 'driver' },
    ],
  },
  {
    slug: 'metro',
    name: 'Metro Recovery',
    users: [
      { email: 'owner@metro.test', firstName: 'Mira', lastName: 'Metro', role: 'owner' },
      {
        email: 'dispatcher@metro.test',
        firstName: 'Marc',
        lastName: 'Mason',
        role: 'dispatcher',
      },
      { email: 'driver@metro.test', firstName: 'Mel', lastName: 'Morgan', role: 'driver' },
    ],
  },
];

interface SeedAccount {
  name: string;
  isMotorClub: boolean;
  motorClubNetworkCode: string | null;
  billingTerms: schema.BillingTerm;
}

const SEED_ACCOUNTS: SeedAccount[] = [
  {
    name: 'Agero',
    isMotorClub: true,
    motorClubNetworkCode: 'AGERO',
    billingTerms: 'net_30',
  },
  {
    name: 'Acme Logistics',
    isMotorClub: false,
    motorClubNetworkCode: null,
    billingTerms: 'net_30',
  },
];

interface SeedCustomer {
  name: string;
  phone: string;
  email: string | null;
}

// Use distinct phone digits per tenant so the (tenant, phone) unique
// partial index never collides across reruns. Acme = 1xxx, Metro = 2xxx.
const customersForTenant = (slug: string): SeedCustomer[] => {
  const prefix = slug === 'acme' ? '1' : '2';
  return [
    { name: 'Sam Carter', phone: `+1555${prefix}10001`, email: 'sam@example.test' },
    { name: 'Riley Owens', phone: `+1555${prefix}10002`, email: 'riley@example.test' },
    { name: 'Jordan Kim', phone: `+1555${prefix}10003`, email: 'jordan@example.test' },
    { name: 'Casey Patel', phone: `+1555${prefix}10004`, email: 'casey@example.test' },
  ];
};

interface SeedVehicle {
  vin: string;
  plate: string;
  plateState: string;
  year: number;
  make: string;
  model: string;
  color: string;
  vehicleClass: schema.VehicleClass;
  drivetrain: schema.Drivetrain;
  isElectric: boolean;
}

// Realistic 17-char VINs. None contain I, O, or Q (per VIN spec).
const vehiclesForTenant = (slug: string): SeedVehicle[] => {
  const tag = slug.toUpperCase().slice(0, 1);
  return [
    {
      vin: `1HGCM82633A00400${tag === 'A' ? '4' : '5'}`,
      plate: `${tag}AC1234`,
      plateState: 'OH',
      year: 2003,
      make: 'Honda',
      model: 'Accord',
      color: 'Silver',
      vehicleClass: 'light_duty',
      drivetrain: 'FWD',
      isElectric: false,
    },
    {
      vin: `1FTFW1ET5DFC1023${tag === 'A' ? '5' : '6'}`,
      plate: `${tag}TR5678`,
      plateState: 'OH',
      year: 2013,
      make: 'Ford',
      model: 'F-150',
      color: 'Black',
      vehicleClass: 'light_duty',
      drivetrain: '4WD',
      isElectric: false,
    },
    {
      vin: `5YJ3E1EA7KF31745${tag === 'A' ? '6' : '7'}`,
      plate: `${tag}EV9012`,
      plateState: 'CA',
      year: 2019,
      make: 'Tesla',
      model: 'Model 3',
      color: 'White',
      vehicleClass: 'light_duty',
      drivetrain: 'RWD',
      isElectric: true,
    },
    {
      vin: `1XPWD40X1ED21533${tag === 'A' ? '7' : '8'}`,
      plate: `${tag}HD3456`,
      plateState: 'TX',
      year: 2014,
      make: 'Peterbilt',
      model: '579',
      color: 'Red',
      vehicleClass: 'heavy_duty',
      drivetrain: 'RWD',
      isElectric: false,
    },
    {
      vin: `JTDKN3DU8E0073${tag === 'A' ? '456' : '457'}`,
      plate: `${tag}LD7890`,
      plateState: 'NY',
      year: 2014,
      make: 'Toyota',
      model: 'Prius',
      color: 'Blue',
      vehicleClass: 'light_duty',
      drivetrain: 'FWD',
      isElectric: false,
    },
    {
      vin: `2C3CDXBG3FH82542${tag === 'A' ? '8' : '9'}`,
      plate: `${tag}CR2345`,
      plateState: 'FL',
      year: 2015,
      make: 'Dodge',
      model: 'Charger',
      color: 'Gray',
      vehicleClass: 'light_duty',
      drivetrain: 'RWD',
      isElectric: false,
    },
  ];
};

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: adminUrl, max: 2 });
  const db = drizzle(pool, { schema });
  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  try {
    for (const t of SEED_DATA) {
      log(`tenant: ${t.slug}`);
      const existing = await db.query.tenants.findFirst({
        where: eq(schema.tenants.slug, t.slug),
      });

      const tenantId = existing?.id ?? uuidv7();
      if (!existing) {
        await db.insert(schema.tenants).values({
          id: tenantId,
          slug: t.slug,
          name: t.name,
          status: 'active',
        });
        log(`  inserted tenant ${t.slug}`);
      } else {
        log(`  tenant ${t.slug} already exists, skipping`);
      }

      let ownerUserId: string | null = null;
      for (const u of t.users) {
        const existingUser = await db.query.users.findFirst({
          where: (table, { and: andF, eq: eqF }) =>
            andF(eqF(table.tenantId, tenantId), eqF(table.email, u.email)),
        });
        if (existingUser) {
          log(`  user ${u.email} already exists, skipping`);
          if (u.role === 'owner') ownerUserId = existingUser.id;
          continue;
        }
        const userId = uuidv7();
        await db.insert(schema.users).values({
          id: userId,
          tenantId,
          email: u.email,
          passwordHash,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
        });
        log(`  inserted user ${u.email}`);
        if (u.role === 'owner') ownerUserId = userId;
      }

      // ---------- rate_sheets (default) ----------
      // Every tenant gets a default rate sheet seeded so the call-intake
      // flow has something to quote against. Account-level rate sheets are
      // additive in later sessions; they override this default at quote time.
      let defaultRateSheetId: string | null = null;
      const existingDefault = await db.query.rateSheets.findFirst({
        where: and(
          eq(schema.rateSheets.tenantId, tenantId),
          eq(schema.rateSheets.name, 'Tenant Default'),
        ),
      });
      if (existingDefault) {
        defaultRateSheetId = existingDefault.id;
        log('  default rate sheet already exists, skipping');
      } else {
        defaultRateSheetId = uuidv7();
        await db.insert(schema.rateSheets).values({
          id: defaultRateSheetId,
          tenantId,
          name: 'Tenant Default',
          notes: 'Seeded default rate sheet. Edit in Tenant Settings.',
          definition: DEFAULT_RATE_SHEET_DEFINITION,
          createdBy: ownerUserId,
        });
        await db
          .insert(schema.tenantDefaultRateSheets)
          .values({
            tenantId,
            rateSheetId: defaultRateSheetId,
            updatedBy: ownerUserId,
          })
          .onConflictDoUpdate({
            target: schema.tenantDefaultRateSheets.tenantId,
            set: { rateSheetId: defaultRateSheetId, updatedAt: new Date() },
          });
        log('  inserted default rate sheet');
      }

      // ---------- accounts ----------
      const accountIds: Record<string, string> = {};
      for (const a of SEED_ACCOUNTS) {
        const existingAccount = await db.query.accounts.findFirst({
          where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.name, a.name)),
        });
        if (existingAccount) {
          accountIds[a.name] = existingAccount.id;
          log(`  account ${a.name} already exists, skipping`);
          continue;
        }
        const id = uuidv7();
        await db.insert(schema.accounts).values({
          id,
          tenantId,
          name: a.name,
          isMotorClub: a.isMotorClub,
          motorClubNetworkCode: a.motorClubNetworkCode,
          billingTerms: a.billingTerms,
          creditLimit: a.isMotorClub ? null : '50000.00',
          createdBy: ownerUserId,
        });
        accountIds[a.name] = id;
        log(`  inserted account ${a.name}`);
      }

      // ---------- customers ----------
      const customerSeeds = customersForTenant(t.slug);
      const customerIds: string[] = [];
      for (const c of customerSeeds) {
        const existingCustomer = await db.query.customers.findFirst({
          where: and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, c.phone)),
        });
        if (existingCustomer) {
          customerIds.push(existingCustomer.id);
          log(`  customer ${c.name} already exists, skipping`);
          continue;
        }
        const id = uuidv7();
        await db.insert(schema.customers).values({
          id,
          tenantId,
          type: 'cash',
          name: c.name,
          phone: c.phone,
          email: c.email,
          createdBy: ownerUserId,
        });
        customerIds.push(id);
        log(`  inserted customer ${c.name}`);
      }

      // ---------- vehicles ----------
      const vehicleSeeds = vehiclesForTenant(t.slug);
      const vehicleIds: string[] = [];
      for (const v of vehicleSeeds) {
        const existingVehicle = await db.query.vehicles.findFirst({
          where: and(eq(schema.vehicles.tenantId, tenantId), eq(schema.vehicles.vin, v.vin)),
        });
        if (existingVehicle) {
          vehicleIds.push(existingVehicle.id);
          log(`  vehicle ${v.vin} already exists, skipping`);
          continue;
        }
        const id = uuidv7();
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
          drivetrain: v.drivetrain,
          isElectric: v.isElectric,
          createdBy: ownerUserId,
        });
        vehicleIds.push(id);
        log(`  inserted vehicle ${v.year} ${v.make} ${v.model}`);
      }

      // ---------- customer_vehicles ----------
      // Pair customer[i] ↔ vehicle[i] (4 customers, 4 of 6 vehicles get owners).
      for (let i = 0; i < customerIds.length; i++) {
        const cId = customerIds[i];
        const vId = vehicleIds[i];
        if (!cId || !vId) continue;
        const existingLink = await db.query.customerVehicles.findFirst({
          where: and(
            eq(schema.customerVehicles.tenantId, tenantId),
            eq(schema.customerVehicles.customerId, cId),
            eq(schema.customerVehicles.vehicleId, vId),
          ),
        });
        if (existingLink) continue;
        await db.insert(schema.customerVehicles).values({
          id: uuidv7(),
          tenantId,
          customerId: cId,
          vehicleId: vId,
          relationship: 'owner',
          isPrimary: true,
        });
      }

      // ---------- trucks ----------
      // Each tenant gets 4 trucks of varied capability: a flatbed, a
      // wheel-lift, a heavy-duty, and a service truck. Unit numbers are
      // tenant-tagged (acme = T-A-NN, metro = T-M-NN) so a single shared
      // dev DB can host both without unit_number collisions.
      const tenantTag = t.slug === 'acme' ? 'A' : 'M';
      const truckSeeds = [
        {
          unit: `T-${tenantTag}-01`,
          type: 'flatbed' as const,
          year: '2021',
          make: 'Ford',
          model: 'F-550',
        },
        {
          unit: `T-${tenantTag}-02`,
          type: 'wheel_lift' as const,
          year: '2020',
          make: 'Chevy',
          model: 'Silverado 5500',
        },
        {
          unit: `T-${tenantTag}-03`,
          type: 'heavy_duty' as const,
          year: '2019',
          make: 'Peterbilt',
          model: '337',
        },
        {
          unit: `T-${tenantTag}-04`,
          type: 'light_duty' as const,
          year: '2022',
          make: 'Ford',
          model: 'F-450',
        },
      ];
      const truckIds: string[] = [];
      for (const tk of truckSeeds) {
        const existingTruck = await db.query.trucks.findFirst({
          where: and(eq(schema.trucks.tenantId, tenantId), eq(schema.trucks.unitNumber, tk.unit)),
        });
        if (existingTruck) {
          truckIds.push(existingTruck.id);
          continue;
        }
        const id = uuidv7();
        await db.insert(schema.trucks).values({
          id,
          tenantId,
          unitNumber: tk.unit,
          truckType: tk.type,
          year: tk.year,
          make: tk.make,
          model: tk.model,
          inService: true,
          createdBy: ownerUserId,
        });
        truckIds.push(id);
        log(`  inserted truck ${tk.unit}`);
      }

      // ---------- drivers ----------
      const driverSeeds =
        t.slug === 'acme'
          ? [
              { firstName: 'Drew', lastName: 'Driver', empNum: 'A-D01', cdl: 'A' as const },
              { firstName: 'Tasha', lastName: 'Williams', empNum: 'A-D02', cdl: 'B' as const },
              { firstName: 'Miguel', lastName: 'Reyes', empNum: 'A-D03', cdl: 'A' as const },
              { firstName: 'Lena', lastName: 'Park', empNum: 'A-D04', cdl: 'C' as const },
            ]
          : [
              { firstName: 'Mel', lastName: 'Morgan', empNum: 'M-D01', cdl: 'A' as const },
              { firstName: 'Sarah', lastName: 'Khan', empNum: 'M-D02', cdl: 'B' as const },
              { firstName: 'Jordan', lastName: 'Hayes', empNum: 'M-D03', cdl: 'A' as const },
              { firstName: 'Ren', lastName: 'Tanaka', empNum: 'M-D04', cdl: 'C' as const },
            ];
      const driverIds: string[] = [];
      for (const d of driverSeeds) {
        const existingDriver = await db.query.drivers.findFirst({
          where: and(
            eq(schema.drivers.tenantId, tenantId),
            eq(schema.drivers.employeeNumber, d.empNum),
          ),
        });
        if (existingDriver) {
          driverIds.push(existingDriver.id);
          continue;
        }
        const id = uuidv7();
        await db.insert(schema.drivers).values({
          id,
          tenantId,
          employeeNumber: d.empNum,
          firstName: d.firstName,
          lastName: d.lastName,
          cdlClass: d.cdl,
          active: true,
          createdBy: ownerUserId,
        });
        driverIds.push(id);
        log(`  inserted driver ${d.firstName} ${d.lastName}`);
      }

      // ---------- driver_shifts ----------
      // One open shift per driver, paired with the matching truck.
      for (let i = 0; i < driverIds.length; i++) {
        const driverId = driverIds[i];
        const truckId = truckIds[i];
        if (!driverId) continue;
        const existingShift = await db.query.driverShifts.findFirst({
          where: and(
            eq(schema.driverShifts.tenantId, tenantId),
            eq(schema.driverShifts.driverId, driverId),
          ),
        });
        if (existingShift) continue;
        await db.insert(schema.driverShifts).values({
          id: uuidv7(),
          tenantId,
          driverId,
          truckId: truckId ?? null,
          status: 'available',
          createdBy: ownerUserId,
        });
      }
    }

    log(`done. login with any seeded email + password "${SEED_PASSWORD}"`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[seed] FAILED: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
