/**
 * Fleet contract schemas — drivers, trucks, shifts, assignments, documents,
 * DVIRs, maintenance, and the rolled-up expirations dashboard.
 *
 * Single source of truth for the API + web. Stored as one big file because
 * the types interlock; splitting forces a tower of cross-imports for tiny
 * gains. If the file ever passes ~600 LOC we revisit.
 */
import { z } from 'zod';
import { phoneE164Schema, usStateSchema } from './customer';

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export const driverCdlClassValues = ['none', 'A', 'B', 'C', 'non_cdl'] as const;
export type DriverCdlClass = (typeof driverCdlClassValues)[number];

export const driverEmploymentStatusValues = ['active', 'on_leave', 'terminated'] as const;
export type DriverEmploymentStatus = (typeof driverEmploymentStatusValues)[number];

export const driverCertificationValues = [
  'WreckMaster_4_5',
  'WreckMaster_6_7',
  'TIM',
  'Tesla_certified',
  'OSHA_10',
  'CPR',
] as const;
export type DriverCertification = (typeof driverCertificationValues)[number];

export const motorClubCredentialsSchema = z.record(
  z.object({
    repId: z.string().optional(),
    dispatcherId: z.string().optional(),
    accountNumber: z.string().optional(),
  }),
);
export type MotorClubCredentials = z.infer<typeof motorClubCredentialsSchema>;

export const driverSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  employeeNumber: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  cdlClass: z.enum(driverCdlClassValues),
  cdlExpiresAt: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseState: z.string().nullable(),
  licenseExpiresAt: z.string().nullable(),
  medicalCardExpiresAt: z.string().nullable(),
  drugTestLastAt: z.string().nullable(),
  roadTestCompletedAt: z.string().nullable(),
  motorClubCredentials: motorClubCredentialsSchema.nullable(),
  certifications: z.array(z.enum(driverCertificationValues)).nullable(),
  hiredAt: z.string().nullable(),
  employmentStatus: z.enum(driverEmploymentStatusValues),
  assignedYardId: z.string().uuid().nullable(),
  commissionRuleId: z.string().uuid().nullable(),
  /**
   * Default invoice-line commission rate for this driver, 0..100 (two
   * decimals). NULL means "no default set" — dispatcher enters per-line
   * during invoice review. Server-only field: never returned by the
   * driver-mobile / /me surface.
   */
  defaultCommissionPct: z.number().min(0).max(100).nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DriverDto = z.infer<typeof driverSchema>;

export const createDriverSchema = z.object({
  userId: z.string().uuid().optional(),
  employeeNumber: z.string().min(1).max(80).optional(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  preferredName: z.string().max(120).optional(),
  phone: phoneE164Schema.optional(),
  email: z.string().email().max(254).optional(),
  cdlClass: z.enum(driverCdlClassValues).default('none'),
  cdlExpiresAt: z.string().date().optional(),
  licenseNumber: z.string().max(80).optional(),
  licenseState: usStateSchema.optional(),
  licenseExpiresAt: z.string().date().optional(),
  medicalCardExpiresAt: z.string().date().optional(),
  drugTestLastAt: z.string().date().optional(),
  roadTestCompletedAt: z.string().date().optional(),
  motorClubCredentials: motorClubCredentialsSchema.optional(),
  certifications: z.array(z.enum(driverCertificationValues)).optional(),
  hiredAt: z.string().date().optional(),
  employmentStatus: z.enum(driverEmploymentStatusValues).default('active'),
  assignedYardId: z.string().uuid().optional(),
  commissionRuleId: z.string().uuid().optional(),
  defaultCommissionPct: z.number().min(0).max(100).optional(),
  notes: z.string().max(4000).optional(),
});
export type CreateDriverPayload = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = z
  .object({
    userId: z.string().uuid().nullable().optional(),
    employeeNumber: z.string().min(1).max(80).nullable().optional(),
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    preferredName: z.string().max(120).nullable().optional(),
    phone: phoneE164Schema.nullable().optional(),
    email: z.string().email().max(254).nullable().optional(),
    cdlClass: z.enum(driverCdlClassValues).optional(),
    cdlExpiresAt: z.string().date().nullable().optional(),
    licenseNumber: z.string().max(80).nullable().optional(),
    licenseState: usStateSchema.nullable().optional(),
    licenseExpiresAt: z.string().date().nullable().optional(),
    medicalCardExpiresAt: z.string().date().nullable().optional(),
    drugTestLastAt: z.string().date().nullable().optional(),
    roadTestCompletedAt: z.string().date().nullable().optional(),
    motorClubCredentials: motorClubCredentialsSchema.nullable().optional(),
    certifications: z.array(z.enum(driverCertificationValues)).nullable().optional(),
    hiredAt: z.string().date().nullable().optional(),
    employmentStatus: z.enum(driverEmploymentStatusValues).optional(),
    assignedYardId: z.string().uuid().nullable().optional(),
    commissionRuleId: z.string().uuid().nullable().optional(),
    defaultCommissionPct: z.number().min(0).max(100).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateDriverPayload = z.infer<typeof updateDriverSchema>;

export const driverFiltersSchema = z.object({
  q: z.string().max(120).optional(),
  employmentStatus: z.enum(driverEmploymentStatusValues).optional(),
  cdlClass: z.enum(driverCdlClassValues).optional(),
  yardId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type DriverFilters = z.infer<typeof driverFiltersSchema>;

export const paginatedDriversSchema = z.object({
  data: z.array(driverSchema),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PaginatedDrivers = z.infer<typeof paginatedDriversSchema>;

// ---------------------------------------------------------------------------
// Trucks
// ---------------------------------------------------------------------------

export const truckTypeValues = [
  'light_duty',
  'medium_duty',
  'heavy_duty',
  'flatbed',
  'wheel_lift',
  'service',
  'other',
] as const;
export type TruckType = (typeof truckTypeValues)[number];

export const truckCapacityClassValues = ['light', 'medium', 'heavy', 'HD'] as const;
export type TruckCapacityClass = (typeof truckCapacityClassValues)[number];

export const truckFuelTypeValues = ['gas', 'diesel', 'EV', 'hybrid'] as const;
export type TruckFuelType = (typeof truckFuelTypeValues)[number];

export const truckStatusValues = ['active', 'in_maintenance', 'out_of_service', 'retired'] as const;
export type TruckStatus = (typeof truckStatusValues)[number];

export const truckEquipmentValues = [
  'flatbed',
  'wheel_lift',
  'wrecker_light',
  'wrecker_medium',
  'wrecker_heavy',
  'integrated',
  'sliding_rotator',
  'dollies',
  'skates',
  'jump_pack',
  'winch',
] as const;
export type TruckEquipment = (typeof truckEquipmentValues)[number];

export const truckSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  unitNumber: z.string(),
  truckType: z.enum(truckTypeValues),
  year: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  plate: z.string().nullable(),
  plateState: z.string().nullable(),
  vin: z.string().nullable(),
  capacityClass: z.enum(truckCapacityClassValues).nullable(),
  gvwrLbs: z.number().int().nullable(),
  fuelType: z.enum(truckFuelTypeValues).nullable(),
  equipment: z.array(z.enum(truckEquipmentValues)).nullable(),
  registrationExpiresAt: z.string().nullable(),
  insuranceExpiresAt: z.string().nullable(),
  iftaLicense: z.string().nullable(),
  irpAccount: z.string().nullable(),
  teslaCertified: z.boolean(),
  aaaFlatbed: z.boolean(),
  heavyDutyCapable: z.boolean(),
  currentOdometer: z.number().int().nullable(),
  odometerUpdatedAt: z.string().datetime().nullable(),
  status: z.enum(truckStatusValues),
  inService: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type TruckDto = z.infer<typeof truckSchema>;

export const createTruckSchema = z.object({
  unitNumber: z.string().min(1).max(40),
  truckType: z.enum(truckTypeValues).default('light_duty'),
  year: z
    .string()
    .regex(/^[0-9]{4}$/, '4-digit year required')
    .optional(),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  plate: z.string().max(20).optional(),
  plateState: usStateSchema.optional(),
  vin: z
    .string()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'VIN must be 17 chars (no I/O/Q)')
    .optional(),
  capacityClass: z.enum(truckCapacityClassValues).optional(),
  gvwrLbs: z.number().int().positive().optional(),
  fuelType: z.enum(truckFuelTypeValues).optional(),
  equipment: z.array(z.enum(truckEquipmentValues)).optional(),
  registrationExpiresAt: z.string().date().optional(),
  insuranceExpiresAt: z.string().date().optional(),
  iftaLicense: z.string().max(80).optional(),
  irpAccount: z.string().max(80).optional(),
  teslaCertified: z.boolean().optional(),
  aaaFlatbed: z.boolean().optional(),
  heavyDutyCapable: z.boolean().optional(),
  currentOdometer: z.number().int().nonnegative().optional(),
  status: z.enum(truckStatusValues).default('active'),
  notes: z.string().max(4000).optional(),
});
export type CreateTruckPayload = z.infer<typeof createTruckSchema>;

export const updateTruckSchema = z
  .object({
    unitNumber: z.string().min(1).max(40).optional(),
    truckType: z.enum(truckTypeValues).optional(),
    year: z
      .string()
      .regex(/^[0-9]{4}$/)
      .nullable()
      .optional(),
    make: z.string().max(80).nullable().optional(),
    model: z.string().max(80).nullable().optional(),
    plate: z.string().max(20).nullable().optional(),
    plateState: usStateSchema.nullable().optional(),
    vin: z
      .string()
      .regex(/^[A-HJ-NPR-Z0-9]{17}$/)
      .nullable()
      .optional(),
    capacityClass: z.enum(truckCapacityClassValues).nullable().optional(),
    gvwrLbs: z.number().int().positive().nullable().optional(),
    fuelType: z.enum(truckFuelTypeValues).nullable().optional(),
    equipment: z.array(z.enum(truckEquipmentValues)).nullable().optional(),
    registrationExpiresAt: z.string().date().nullable().optional(),
    insuranceExpiresAt: z.string().date().nullable().optional(),
    iftaLicense: z.string().max(80).nullable().optional(),
    irpAccount: z.string().max(80).nullable().optional(),
    teslaCertified: z.boolean().optional(),
    aaaFlatbed: z.boolean().optional(),
    heavyDutyCapable: z.boolean().optional(),
    currentOdometer: z.number().int().nonnegative().nullable().optional(),
    status: z.enum(truckStatusValues).optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type UpdateTruckPayload = z.infer<typeof updateTruckSchema>;

export const truckFiltersSchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(truckStatusValues).optional(),
  capacityClass: z.enum(truckCapacityClassValues).optional(),
  equipment: z.enum(truckEquipmentValues).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type TruckFilters = z.infer<typeof truckFiltersSchema>;

export const paginatedTrucksSchema = z.object({
  data: z.array(truckSchema),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PaginatedTrucks = z.infer<typeof paginatedTrucksSchema>;

// ---------------------------------------------------------------------------
// Driver-truck assignments
// ---------------------------------------------------------------------------

export const driverTruckAssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  truckId: z.string().uuid(),
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
});
export type DriverTruckAssignmentDto = z.infer<typeof driverTruckAssignmentSchema>;

export const createDriverTruckAssignmentSchema = z.object({
  driverId: z.string().uuid(),
  truckId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});
export type CreateDriverTruckAssignmentPayload = z.infer<typeof createDriverTruckAssignmentSchema>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentOwnerTypeValues = [
  'truck',
  'driver',
  'vehicle',
  'customer',
  'account',
  'job',
] as const;
export type DocumentOwnerType = (typeof documentOwnerTypeValues)[number];

export const documentTypeValues = [
  'registration',
  'insurance',
  'inspection',
  'cdl',
  'license',
  'medical_card',
  'drug_test',
  'road_test',
  'training_cert',
  'tax_exempt',
  'coi',
  'photo',
  'invoice',
  'other',
] as const;
export type DocumentType = (typeof documentTypeValues)[number];

export const documentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  ownerType: z.enum(documentOwnerTypeValues),
  ownerId: z.string().uuid(),
  docType: z.enum(documentTypeValues),
  fileUrl: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedBy: z.string().uuid().nullable(),
  uploadedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});
export type DocumentDto = z.infer<typeof documentSchema>;

export const documentFiltersSchema = z.object({
  ownerType: z.enum(documentOwnerTypeValues).optional(),
  ownerId: z.string().uuid().optional(),
  docType: z.enum(documentTypeValues).optional(),
});
export type DocumentFilters = z.infer<typeof documentFiltersSchema>;

// ---------------------------------------------------------------------------
// DVIRs
// ---------------------------------------------------------------------------

export const dvirTypeValues = ['pre_trip', 'post_trip'] as const;
export type DvirType = (typeof dvirTypeValues)[number];

export const dvirStatusValues = ['no_defects', 'minor', 'out_of_service'] as const;
export type DvirStatus = (typeof dvirStatusValues)[number];

export const dvirDefectSeverityValues = ['minor', 'major', 'out_of_service'] as const;
export type DvirDefectSeverity = (typeof dvirDefectSeverityValues)[number];

export const dvirDefectSchema = z.object({
  component: z.string().min(1).max(120),
  severity: z.enum(dvirDefectSeverityValues),
  notes: z.string().max(2000).optional(),
  photoUrl: z.string().max(2048).optional(),
});
export type DvirDefect = z.infer<typeof dvirDefectSchema>;

export const dvirSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  truckId: z.string().uuid(),
  type: z.enum(dvirTypeValues),
  submittedAt: z.string().datetime(),
  odometerReading: z.number().int().nonnegative().nullable(),
  defects: z.array(dvirDefectSchema),
  status: z.enum(dvirStatusValues),
  notes: z.string().nullable(),
});
export type DvirDto = z.infer<typeof dvirSchema>;

export const createDvirSchema = z.object({
  driverId: z.string().uuid(),
  truckId: z.string().uuid(),
  type: z.enum(dvirTypeValues),
  odometerReading: z.number().int().nonnegative().optional(),
  defects: z.array(dvirDefectSchema).default([]),
  notes: z.string().max(4000).optional(),
});
export type CreateDvirPayload = z.infer<typeof createDvirSchema>;

export const dvirFiltersSchema = z.object({
  driverId: z.string().uuid().optional(),
  truckId: z.string().uuid().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  status: z.enum(dvirStatusValues).optional(),
});
export type DvirFilters = z.infer<typeof dvirFiltersSchema>;

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export const maintenanceScheduleTypeValues = ['mileage', 'time', 'both'] as const;
export type MaintenanceScheduleType = (typeof maintenanceScheduleTypeValues)[number];

export const maintenanceServiceTypeValues = [
  'oil',
  'tires',
  'brakes',
  'dot_inspection',
  'transmission',
  'coolant',
  'air_filter',
  'fuel_filter',
  'custom',
] as const;
export type MaintenanceServiceType = (typeof maintenanceServiceTypeValues)[number];

export const maintenanceScheduleStatusValues = ['scheduled', 'overdue', 'completed'] as const;
export type MaintenanceScheduleStatus = (typeof maintenanceScheduleStatusValues)[number];

export const maintenanceScheduleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  truckId: z.string().uuid(),
  scheduleType: z.enum(maintenanceScheduleTypeValues),
  serviceType: z.enum(maintenanceServiceTypeValues),
  customLabel: z.string().nullable(),
  intervalMiles: z.number().int().nullable(),
  intervalDays: z.number().int().nullable(),
  lastServicedAt: z.string().nullable(),
  lastServicedMiles: z.number().int().nullable(),
  nextDueAt: z.string().nullable(),
  nextDueMiles: z.number().int().nullable(),
  status: z.enum(maintenanceScheduleStatusValues),
  notes: z.string().nullable(),
});
export type MaintenanceScheduleDto = z.infer<typeof maintenanceScheduleSchema>;

export const createMaintenanceScheduleSchema = z
  .object({
    truckId: z.string().uuid(),
    scheduleType: z.enum(maintenanceScheduleTypeValues),
    serviceType: z.enum(maintenanceServiceTypeValues),
    customLabel: z.string().max(120).optional(),
    intervalMiles: z.number().int().positive().optional(),
    intervalDays: z.number().int().positive().optional(),
    lastServicedAt: z.string().date().optional(),
    lastServicedMiles: z.number().int().nonnegative().optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine(
    (v) => {
      if (v.scheduleType === 'mileage') return v.intervalMiles !== undefined;
      if (v.scheduleType === 'time') return v.intervalDays !== undefined;
      return v.intervalMiles !== undefined && v.intervalDays !== undefined;
    },
    { message: 'interval_miles / interval_days must match schedule_type' },
  );
export type CreateMaintenanceSchedulePayload = z.infer<typeof createMaintenanceScheduleSchema>;

export const maintenanceRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  truckId: z.string().uuid(),
  scheduleId: z.string().uuid().nullable(),
  performedAt: z.string(),
  performedMiles: z.number().int().nullable(),
  serviceType: z.enum(maintenanceServiceTypeValues),
  customLabel: z.string().nullable(),
  costCents: z.number().int().nonnegative(),
  vendor: z.string().nullable(),
  notes: z.string().nullable(),
  documentIds: z.array(z.string().uuid()).nullable(),
});
export type MaintenanceRecordDto = z.infer<typeof maintenanceRecordSchema>;

export const createMaintenanceRecordSchema = z.object({
  truckId: z.string().uuid(),
  scheduleId: z.string().uuid().optional(),
  performedAt: z.string().date(),
  performedMiles: z.number().int().nonnegative().optional(),
  serviceType: z.enum(maintenanceServiceTypeValues),
  customLabel: z.string().max(120).optional(),
  costCents: z.number().int().nonnegative().default(0),
  vendor: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});
export type CreateMaintenanceRecordPayload = z.infer<typeof createMaintenanceRecordSchema>;

// ---------------------------------------------------------------------------
// Expirations dashboard
// ---------------------------------------------------------------------------

export const expirationSeverityValues = ['expired', 'critical', 'warning'] as const;
export type ExpirationSeverity = (typeof expirationSeverityValues)[number];

export const expirationKindValues = [
  'driver_cdl',
  'driver_license',
  'driver_medical_card',
  'truck_registration',
  'truck_insurance',
  'document',
] as const;
export type ExpirationKind = (typeof expirationKindValues)[number];

export const expirationRowSchema = z.object({
  kind: z.enum(expirationKindValues),
  severity: z.enum(expirationSeverityValues),
  /** Days until expiry — negative when already expired. */
  daysUntilExpiry: z.number().int(),
  expiresAt: z.string(),
  /** "Driver: Mike Smith" / "Truck: T-12 / Registration". */
  label: z.string(),
  /** Owner of the expiring item — driver / truck row id. */
  entityId: z.string().uuid(),
  entityType: z.enum(['driver', 'truck']),
  /** When kind=document, the documents.id; else null. */
  documentId: z.string().uuid().nullable(),
});
export type ExpirationRow = z.infer<typeof expirationRowSchema>;

export const expirationsResponseSchema = z.object({
  windowDays: z.number().int(),
  expired: z.array(expirationRowSchema),
  critical: z.array(expirationRowSchema),
  warning: z.array(expirationRowSchema),
});
export type ExpirationsResponse = z.infer<typeof expirationsResponseSchema>;

export const expirationsFiltersSchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
  kind: z.enum(expirationKindValues).optional(),
  entityType: z.enum(['driver', 'truck']).optional(),
});
export type ExpirationsFilters = z.infer<typeof expirationsFiltersSchema>;
