/**
 * Demo mock data — session-local, no API calls.
 *
 * All data is hardcoded TypeScript objects. Every user who visits /demo
 * gets the same initial state. Any mutations are local to their browser
 * session via React state — nothing persists.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface DemoDriver {
  driverId: string;
  firstName: string;
  lastName: string;
  truckUnitNumber: string | null;
  shiftStatus: 'available' | 'en_route' | 'on_scene' | 'in_progress' | 'returning' | 'break';
  currentJobId: string | null;
  currentJobNumber: string | null;
  currentJobStatus: string | null;
  phone: string;
}

export interface DemoJob {
  id: string;
  jobNumber: string;
  customerId: string | null;
  customerName: string | null;
  serviceType: string;
  status: string;
  createdAt: string;
  driverId: string | null;
  driverName: string | null;
  pickupAddress: string;
  dropoffAddress: string | null;
  vehicleDesc: string;
  amountCents: number;
}

export interface DemoCustomer {
  id: string;
  name: string;
  type: 'motor_club' | 'insurance' | 'body_shop' | 'cash' | 'fleet';
  phone: string;
  jobCount: number;
  revenueCents: number;
  slaMinutes: number | null;
}

export interface DemoRevenueByDriver {
  driverId: string | null;
  driverName: string;
  revenueCents: number;
}

// ─── Seed data ──────────────────────────────────────────────────────

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

export const DEMO_TENANT = {
  id: 'demo-tenant-001',
  name: 'Apex Towing & Recovery',
  accentColor: '#FF6A1A',
  primaryColor: '#1A1E2A',
  dispatchPhone: '(555) 867-5309',
};

export const DEMO_USER = {
  id: 'demo-user-001',
  email: 'chris@apextowing.demo',
  firstName: 'Chris',
  lastName: 'P.',
  role: 'OWNER' as const,
  emailVerifiedAt: new Date().toISOString(),
};

export const DEMO_DRIVERS: DemoDriver[] = [
  {
    driverId: 'drv-001',
    firstName: 'Mike',
    lastName: 'Ramos',
    truckUnitNumber: '14',
    shiftStatus: 'en_route',
    currentJobId: 'job-001',
    currentJobNumber: '2461',
    currentJobStatus: 'enroute',
    phone: '(555) 111-0001',
  },
  {
    driverId: 'drv-002',
    firstName: 'Sarah',
    lastName: 'Kim',
    truckUnitNumber: '07',
    shiftStatus: 'on_scene',
    currentJobId: 'job-002',
    currentJobNumber: '2459',
    currentJobStatus: 'on_scene',
    phone: '(555) 111-0002',
  },
  {
    driverId: 'drv-003',
    firstName: 'Jake',
    lastName: 'Thornton',
    truckUnitNumber: '21',
    shiftStatus: 'available',
    currentJobId: null,
    currentJobNumber: null,
    currentJobStatus: null,
    phone: '(555) 111-0003',
  },
  {
    driverId: 'drv-004',
    firstName: 'Maria',
    lastName: 'Gutierrez',
    truckUnitNumber: '03',
    shiftStatus: 'returning',
    currentJobId: null,
    currentJobNumber: null,
    currentJobStatus: null,
    phone: '(555) 111-0004',
  },
];

export const DEMO_JOBS: DemoJob[] = [
  {
    id: 'job-001',
    jobNumber: '2461',
    customerId: 'cust-001',
    customerName: 'AAA Southwest',
    serviceType: 'tow',
    status: 'enroute',
    createdAt: minutesAgo(18),
    driverId: 'drv-001',
    driverName: 'Mike Ramos',
    pickupAddress: '4521 E McDowell Rd, Phoenix, AZ 85008',
    dropoffAddress: 'Apex Yard — 1800 W Grant St',
    vehicleDesc: '2019 Toyota Camry (Silver)',
    amountCents: 18500,
  },
  {
    id: 'job-002',
    jobNumber: '2459',
    customerId: 'cust-002',
    customerName: 'State Farm Claims',
    serviceType: 'lockout',
    status: 'on_scene',
    createdAt: minutesAgo(34),
    driverId: 'drv-002',
    driverName: 'Sarah Kim',
    pickupAddress: '7120 N 35th Ave, Phoenix, AZ 85051',
    dropoffAddress: null,
    vehicleDesc: '2022 Ford F-150 (Blue)',
    amountCents: 7500,
  },
  {
    id: 'job-003',
    jobNumber: '2457',
    customerId: null,
    customerName: 'Walk-in (Cash)',
    serviceType: 'jump_start',
    status: 'dispatched',
    createdAt: minutesAgo(8),
    driverId: null,
    driverName: null,
    pickupAddress: '2901 S Rural Rd, Tempe, AZ 85282',
    dropoffAddress: null,
    vehicleDesc: '2017 Honda Civic (Black)',
    amountCents: 6500,
  },
  {
    id: 'job-004',
    jobNumber: '2455',
    customerId: 'cust-001',
    customerName: 'AAA Southwest',
    serviceType: 'tow',
    status: 'completed',
    createdAt: minutesAgo(120),
    driverId: 'drv-004',
    driverName: 'Maria Gutierrez',
    pickupAddress: '1540 W Camelback Rd, Phoenix, AZ 85015',
    dropoffAddress: 'Courtesy Chevrolet — 1233 E Camelback Rd',
    vehicleDesc: '2020 Chevy Malibu (Red)',
    amountCents: 22000,
  },
  {
    id: 'job-005',
    jobNumber: '2453',
    customerId: 'cust-003',
    customerName: 'Allstate Motor Club',
    serviceType: 'tire_change',
    status: 'completed',
    createdAt: minutesAgo(195),
    driverId: 'drv-001',
    driverName: 'Mike Ramos',
    pickupAddress: 'I-10 & 51st Ave — eastbound shoulder',
    dropoffAddress: null,
    vehicleDesc: '2021 Hyundai Sonata (White)',
    amountCents: 9500,
  },
  {
    id: 'job-006',
    jobNumber: '2451',
    customerId: 'cust-002',
    customerName: 'State Farm Claims',
    serviceType: 'tow',
    status: 'completed',
    createdAt: minutesAgo(260),
    driverId: 'drv-003',
    driverName: 'Jake Thornton',
    pickupAddress: '3030 N Central Ave, Phoenix, AZ 85012',
    dropoffAddress: 'ABRA Auto Body — 4410 E Washington',
    vehicleDesc: '2018 Nissan Altima (Gray)',
    amountCents: 19500,
  },
  {
    id: 'job-007',
    jobNumber: '2449',
    customerId: 'cust-004',
    customerName: 'Valley Auto Body',
    serviceType: 'winch',
    status: 'completed',
    createdAt: minutesAgo(310),
    driverId: 'drv-002',
    driverName: 'Sarah Kim',
    pickupAddress: 'Desert wash near 67th Ave & Baseline',
    dropoffAddress: 'Valley Auto Body — 5020 W Baseline',
    vehicleDesc: '2023 Jeep Wrangler (Green)',
    amountCents: 35000,
  },
  {
    id: 'job-008',
    jobNumber: '2447',
    customerId: null,
    customerName: 'Walk-in (Cash)',
    serviceType: 'fuel',
    status: 'completed',
    createdAt: minutesAgo(380),
    driverId: 'drv-004',
    driverName: 'Maria Gutierrez',
    pickupAddress: '10220 N Metro Pkwy E, Phoenix, AZ 85051',
    dropoffAddress: null,
    vehicleDesc: '2016 BMW 328i (Black)',
    amountCents: 8500,
  },
];

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    id: 'cust-001',
    name: 'AAA Southwest',
    type: 'motor_club',
    phone: '(800) 222-4357',
    jobCount: 342,
    revenueCents: 485000_00,
    slaMinutes: 45,
  },
  {
    id: 'cust-002',
    name: 'State Farm Claims',
    type: 'insurance',
    phone: '(800) 732-5246',
    jobCount: 187,
    revenueCents: 289000_00,
    slaMinutes: 60,
  },
  {
    id: 'cust-003',
    name: 'Allstate Motor Club',
    type: 'motor_club',
    phone: '(800) 255-7828',
    jobCount: 98,
    revenueCents: 156000_00,
    slaMinutes: 50,
  },
  {
    id: 'cust-004',
    name: 'Valley Auto Body',
    type: 'body_shop',
    phone: '(602) 555-0147',
    jobCount: 64,
    revenueCents: 112000_00,
    slaMinutes: null,
  },
  {
    id: 'cust-005',
    name: 'Desert Fleet Services',
    type: 'fleet',
    phone: '(480) 555-0289',
    jobCount: 41,
    revenueCents: 73000_00,
    slaMinutes: 30,
  },
];

export const DEMO_REVENUE_BY_DRIVER: DemoRevenueByDriver[] = [
  { driverId: 'drv-001', driverName: 'Mike Ramos', revenueCents: 28000 },
  { driverId: 'drv-002', driverName: 'Sarah Kim', revenueCents: 42500 },
  { driverId: 'drv-003', driverName: 'Jake Thornton', revenueCents: 19500 },
  { driverId: 'drv-004', driverName: 'Maria Gutierrez', revenueCents: 30500 },
];

// Derived
export const DEMO_ACTIVE_CALLS = DEMO_JOBS.filter(
  (j) => j.status !== 'completed' && j.status !== 'cancelled',
).length;

export const DEMO_TODAYS_REVENUE_CENTS = DEMO_REVENUE_BY_DRIVER.reduce(
  (sum, r) => sum + r.revenueCents,
  0,
);

export const DEMO_AVG_ETA_MINUTES = 22;

// ─── Simulation route waypoints (Phoenix metro) ─────────────────────

export interface RouteWaypoint {
  lat: number;
  lng: number;
  label?: string;
}

export const SIMULATION_ROUTE: RouteWaypoint[] = [
  { lat: 33.4484, lng: -112.074, label: 'Dispatch (Apex yard)' },
  { lat: 33.451, lng: -112.068 },
  { lat: 33.4545, lng: -112.059 },
  { lat: 33.4572, lng: -112.048 },
  { lat: 33.4601, lng: -112.039 },
  { lat: 33.4628, lng: -112.032 },
  { lat: 33.4655, lng: -112.024 },
  { lat: 33.4672, lng: -112.018 },
  { lat: 33.4689, lng: -112.012 },
  { lat: 33.4701, lng: -112.005, label: 'Customer location' },
  { lat: 33.4720, lng: -111.995 },
  { lat: 33.4750, lng: -111.980 },
  { lat: 33.4780, lng: -111.970, label: 'Dropoff location' },
];

export const SIMULATION_MESSAGES = [
  { status: 'dispatched', timeStr: '10:02 AM', body: 'Driver Mike Ramos has been assigned to your call.' },
  { status: 'enroute', timeStr: '10:04 AM', body: 'Mike is en route — ETA 5 minutes.' },
  { status: 'on_scene', timeStr: '10:12 AM', body: 'Mike has arrived on scene.' },
  { status: 'in_progress', timeStr: '10:13 AM', body: 'Service in progress — your vehicle is being loaded.' },
  { status: 'towing', timeStr: '10:18 AM', body: 'Vehicle loaded. Towing to destination.' },
  { status: 'completed', timeStr: '10:35 AM', body: 'Service complete! Thank you for choosing Apex Towing.' },
];
