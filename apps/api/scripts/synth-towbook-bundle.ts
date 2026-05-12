/**
 * Synthetic Towbook bundle generator.
 *
 * Produces a ZIP buffer containing CSVs that match the Towbook column
 * conventions documented in apps/api/src/modules/import/column-mappings/towbook.json.
 * Used by the integration tests and by the founder's smoke-test path
 * before a real Towbook export is available.
 *
 *   import { buildSyntheticBundle } from './synth-towbook-bundle.js';
 *   const zip = buildSyntheticBundle({
 *     customers: 100, vehicles: 200, jobs: 500,
 *     impounds: 50, drivers: 20, trucks: 25,
 *     invoices: 400, payments: 350,
 *     motorClubHistory: 300, attachments: 50,
 *   });
 *
 *   await fs.writeFile('towbook-synth.zip', zip);
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SynthOptions {
  customers: number;
  vehicles: number;
  drivers: number;
  trucks: number;
  jobs: number;
  impounds?: number;
  invoices?: number;
  payments?: number;
  motorClubHistory?: number;
  attachments?: number;
}

const PHONES = ['(310) 555-1234', '(415) 555-2222', '(212) 555-9999', '(310) 555-4444'];
const NAMES = ['Sam Carter', 'Lena Ortiz', 'Mike Cho', 'Renee Watson', 'Jamal King', 'Priya Patel'];
const CITIES = ['Brooklyn', 'Austin', 'Phoenix', 'Detroit', 'Atlanta'];
const STATES = ['NY', 'TX', 'AZ', 'MI', 'GA'];
const VINS = ['1HGBH41JXMN109186', '1M8GDM9AXKP042788', '5XYZH4AG1FG051345', '1FTEW1E50JFA17345'];
const MAKES = ['Honda', 'Ford', 'Toyota', 'Chevy', 'Kia'];
const MODELS = ['Civic', 'F-150', 'Camry', 'Silverado', 'Sorento'];
const NETWORKS = ['Agero', 'AAA', 'Geico', 'State Farm', 'Allstate'];

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;

const toCSV = (rows: Record<string, string | number | null | undefined>[]): string => {
  if (rows.length === 0) return '';
  const header = Object.keys(rows[0]!);
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      header
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return '';
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    );
  }
  return lines.join('\n');
};

interface ZipEntry {
  name: string;
  data: Buffer;
}

const buildZipBytes = (entries: ZipEntry[]): Buffer => {
  // Minimal ZIP writer with STORED (uncompressed) entries — keeps the
  // dependency surface zero for the synth path. Real Towbook exports are
  // already compressed; the importer uses yauzl which handles both.
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const size = e.data.byteLength;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = 0 (stored)
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localHeaders.push(Buffer.concat([local, nameBuf, e.data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralDirs.push(Buffer.concat([central, nameBuf]));

    offset += 30 + nameBuf.length + size;
  }
  const centralStart = offset;
  const centralBytes = Buffer.concat(centralDirs);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localHeaders, centralBytes, end]);
};

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildSyntheticBundle(opts: SynthOptions): Buffer {
  const customers = Array.from({ length: opts.customers }, (_, i) => ({
    towbook_id: `cust-synth-${i + 1}`,
    name: pick(NAMES, i),
    phone_primary: pick(PHONES, i),
    phone_secondary: '',
    email: `customer-${i + 1}-${Date.now()}@example.test`,
    street_address: `${100 + i} Main St`,
    city: pick(CITIES, i),
    state: pick(STATES, i),
    zip: String(10000 + i).padStart(5, '0'),
    account_type: i % 5 === 0 ? 'Account' : 'Cash',
    billing_terms: 'Net 30',
    credit_limit: i % 5 === 0 ? '1000.00' : '',
    coi_expiration: '',
    created_date: '2024-01-15 09:00:00',
  }));

  const vehicles = Array.from({ length: opts.vehicles }, (_, i) => ({
    towbook_id: `veh-synth-${i + 1}`,
    customer_towbook_id: opts.customers > 0 ? `cust-synth-${(i % opts.customers) + 1}` : '',
    year: 2015 + (i % 10),
    make: pick(MAKES, i),
    model: pick(MODELS, i),
    color: 'Silver',
    plate: `PLT${String(i + 1).padStart(4, '0')}`,
    plate_state: pick(STATES, i),
    vin: pick(VINS, i),
    notes: '',
  }));

  const drivers = Array.from({ length: opts.drivers }, (_, i) => ({
    towbook_id: `drv-synth-${i + 1}`,
    name: `Driver ${i + 1}`,
    phone: pick(PHONES, i + 7),
    email: `driver-${i + 1}-${Date.now()}@example.test`,
    license_number: `D${String(i + 1).padStart(8, '0')}`,
    license_state: pick(STATES, i),
    license_expiration: '2027-12-31',
    medical_card_expiration: '2026-06-01',
    hire_date: '2020-01-15',
    termination_date: '',
  }));

  const trucks = Array.from({ length: opts.trucks }, (_, i) => ({
    towbook_id: `tr-synth-${i + 1}`,
    unit_number: `T-${100 + i}`,
    year: 2018 + (i % 8),
    make: pick(MAKES, i),
    model: pick(MODELS, i),
    vin: pick(VINS, i + 1),
    plate: `TRK${String(i + 1).padStart(4, '0')}`,
    plate_state: pick(STATES, i),
    gvwr: 26000 + (i % 5) * 1000,
    equipment_type: i % 2 === 0 ? 'Flatbed' : 'Wheel Lift',
  }));

  const jobs = Array.from({ length: opts.jobs }, (_, i) => ({
    towbook_id: `job-synth-${i + 1}`,
    call_received_at: '2024-03-15 14:32:00',
    service_type: 'Tow',
    source: 'Phone',
    network: i % 3 === 0 ? pick(NETWORKS, i) : '',
    network_case_id: i % 3 === 0 ? `CASE-${i + 1000}` : '',
    pickup_address: `${100 + i} Pickup Ln, ${pick(CITIES, i)} ${pick(STATES, i)}`,
    pickup_lat: 33.0 + i * 0.01,
    pickup_lng: -118.0 - i * 0.01,
    dropoff_address: `${200 + i} Dropoff Rd`,
    dropoff_lat: 33.05 + i * 0.01,
    dropoff_lng: -118.05 - i * 0.01,
    customer_towbook_id: opts.customers > 0 ? `cust-synth-${(i % opts.customers) + 1}` : '',
    vehicle_towbook_id: opts.vehicles > 0 ? `veh-synth-${(i % opts.vehicles) + 1}` : '',
    assigned_driver_towbook_id: opts.drivers > 0 ? `drv-synth-${(i % opts.drivers) + 1}` : '',
    assigned_truck_towbook_id: opts.trucks > 0 ? `tr-synth-${(i % opts.trucks) + 1}` : '',
    status: 'Completed',
    assigned_at: '2024-03-15 14:35:00',
    en_route_at: '2024-03-15 14:37:00',
    on_scene_at: '2024-03-15 14:55:00',
    loaded_at: '2024-03-15 15:05:00',
    in_transit_at: '2024-03-15 15:10:00',
    dropped_at: '2024-03-15 15:40:00',
    cleared_at: '2024-03-15 15:50:00',
    total_charged: (125 + (i % 10) * 25).toFixed(2),
    driver_commission: ((125 + (i % 10) * 25) * 0.3).toFixed(2),
    notes: '',
  }));

  const impounds = Array.from({ length: opts.impounds ?? 0 }, (_, i) => ({
    towbook_id: `imp-synth-${i + 1}`,
    vehicle_towbook_id: opts.vehicles > 0 ? `veh-synth-${(i % opts.vehicles) + 1}` : '',
    impound_date: '2024-04-01 11:00:00',
    yard_name: 'Main Yard',
    hold_type: 'police',
    daily_rate: '45.00',
    release_date: i % 3 === 0 ? '2024-04-05 16:00:00' : '',
    release_reason: '',
    personal_property_inventory: '',
  }));

  const invoices = Array.from({ length: opts.invoices ?? 0 }, (_, i) => ({
    towbook_id: `inv-synth-${i + 1}`,
    job_towbook_id: opts.jobs > 0 ? `job-synth-${(i % opts.jobs) + 1}` : '',
    invoice_number: `INV-${String(20000 + i)}`,
    issued_date: '2024-03-20 09:00:00',
    due_date: '2024-04-19 09:00:00',
    total: (125 + (i % 10) * 25).toFixed(2),
    balance: i % 2 === 0 ? '0.00' : (125 + (i % 10) * 25).toFixed(2),
    status: i % 2 === 0 ? 'paid' : 'open',
  }));

  const payments = Array.from({ length: opts.payments ?? 0 }, (_, i) => ({
    towbook_id: `pay-synth-${i + 1}`,
    invoice_towbook_id:
      (opts.invoices ?? 0) > 0 ? `inv-synth-${(i % (opts.invoices ?? 1)) + 1}` : '',
    received_date: '2024-03-25 14:00:00',
    amount: (125 + (i % 10) * 25).toFixed(2),
    method: i % 3 === 0 ? 'Cash' : i % 3 === 1 ? 'Credit Card' : 'Check',
    reference: i % 3 === 2 ? `CHK${1000 + i}` : '',
  }));

  const motorClubHistory = Array.from({ length: opts.motorClubHistory ?? 0 }, (_, i) => ({
    job_towbook_id: opts.jobs > 0 ? `job-synth-${(i % opts.jobs) + 1}` : '',
    network: pick(NETWORKS, i),
    network_case_id: `CASE-${20000 + i}`,
    partial_fee_amount: i % 5 === 0 ? '15.00' : '',
    partial_fee_reason: i % 5 === 0 ? 'Time over allowance' : '',
  }));

  const attachmentManifest = Array.from({ length: opts.attachments ?? 0 }, (_, i) => ({
    towbook_id: opts.jobs > 0 ? `job-synth-${(i % opts.jobs) + 1}` : '',
    filename: `photo-${i + 1}.jpg`,
    type: 'photo',
  }));

  const entries: ZipEntry[] = [
    { name: 'customers.csv', data: Buffer.from(toCSV(customers), 'utf8') },
    { name: 'vehicles.csv', data: Buffer.from(toCSV(vehicles), 'utf8') },
    { name: 'drivers.csv', data: Buffer.from(toCSV(drivers), 'utf8') },
    { name: 'trucks.csv', data: Buffer.from(toCSV(trucks), 'utf8') },
    { name: 'calls.csv', data: Buffer.from(toCSV(jobs), 'utf8') },
  ];
  if ((opts.impounds ?? 0) > 0) {
    entries.push({ name: 'impounds.csv', data: Buffer.from(toCSV(impounds), 'utf8') });
  }
  if ((opts.invoices ?? 0) > 0) {
    entries.push({ name: 'invoices.csv', data: Buffer.from(toCSV(invoices), 'utf8') });
  }
  if ((opts.payments ?? 0) > 0) {
    entries.push({ name: 'payments.csv', data: Buffer.from(toCSV(payments), 'utf8') });
  }
  if ((opts.motorClubHistory ?? 0) > 0) {
    entries.push({
      name: 'motor_club_history.csv',
      data: Buffer.from(toCSV(motorClubHistory), 'utf8'),
    });
  }
  if ((opts.attachments ?? 0) > 0) {
    entries.push({
      name: 'attachments.csv',
      data: Buffer.from(toCSV(attachmentManifest), 'utf8'),
    });
    // tiny synthetic JPEG bytes per attachment
    for (let i = 0; i < (opts.attachments ?? 0); i++) {
      entries.push({
        name: `media/photo-${i + 1}.jpg`,
        data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      });
    }
  }
  return buildZipBytes(entries);
}

// CLI: writes a sample bundle to disk for the founder's manual smoke test.
//   pnpm --filter @towcommand/api exec tsx scripts/synth-towbook-bundle.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const bundle = buildSyntheticBundle({
    customers: 100,
    vehicles: 200,
    jobs: 500,
    impounds: 50,
    drivers: 20,
    trucks: 25,
    invoices: 400,
    payments: 350,
    motorClubHistory: 300,
    attachments: 50,
  });
  const out = join(process.cwd(), 'towbook-synth.zip');
  writeFile(out, bundle).then(() => {
    process.stdout.write(`Wrote ${out} (${(bundle.byteLength / 1024).toFixed(1)} KiB)\n`);
  });
}
