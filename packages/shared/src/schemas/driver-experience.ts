/**
 * Driver Experience (Session 1) — Zod contracts for the eight new
 * driver-app tables.
 *
 * Mirrors the Drizzle schema enums and column shapes from
 * packages/db/src/schema/driver-*.ts and job-{evidence,field-payments}.ts.
 * Timestamps over the wire are ISO-8601 strings; Drizzle hands them back
 * as Date objects on the server, and we serialize at the boundary —
 * Zod's z.string().datetime() validates either direction without
 * dragging Date into shared client code.
 *
 * Each table has:
 *   - <tableName>Schema           — the read-shape DTO
 *   - create<TableName>Schema     — the API write payload (strict)
 *   - update<TableName>Schema     — partial update (strict, nullable.optional)
 *
 * Append-only ledger tables (acknowledgments, telemetry, offline_actions)
 * intentionally only expose create + read shapes; replaying / editing a
 * historical ledger row is not a supported operation.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. driver_pins
// ---------------------------------------------------------------------------

/**
 * 4–8 digit numeric PIN. The plaintext is only used by the client to
 * generate the bcrypt hash; the server stores `pinHash` and never sees
 * or returns the original value.
 */
export const driverPinPlaintextSchema = z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits');

export const driverPinSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  failedAttempts: z.number().int().min(0),
  lockedUntil: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DriverPinDto = z.infer<typeof driverPinSchema>;

/** Admin sets / rotates the driver's PIN. The plaintext is hashed server-side. */
export const createDriverPinSchema = z
  .object({
    driverId: z.string().uuid(),
    pin: driverPinPlaintextSchema,
  })
  .strict();
export type CreateDriverPinPayload = z.infer<typeof createDriverPinSchema>;

/** Driver enters their PIN to authorize an in-truck switch. */
export const verifyDriverPinSchema = z
  .object({
    driverId: z.string().uuid(),
    pin: driverPinPlaintextSchema,
  })
  .strict();
export type VerifyDriverPinPayload = z.infer<typeof verifyDriverPinSchema>;

/**
 * No general "update PIN" — rotation goes through createDriverPinSchema
 * which replaces the live row. This update is for admin-only state
 * reset (clearing a lockout after manual intervention).
 */
export const updateDriverPinSchema = z
  .object({
    failedAttempts: z.number().int().min(0).optional(),
    lockedUntil: z.string().datetime().nullable().optional(),
  })
  .strict();
export type UpdateDriverPinPayload = z.infer<typeof updateDriverPinSchema>;

// ---------------------------------------------------------------------------
// 2. driver_daily_briefings
// ---------------------------------------------------------------------------

export const driverDailyBriefingSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string(),
  message: z.string(),
  videoUrl: z.string().nullable(),
  videoMinDurationSeconds: z.number().int().min(0),
  isActive: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DriverDailyBriefingDto = z.infer<typeof driverDailyBriefingSchema>;

export const createDriverDailyBriefingSchema = z
  .object({
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(8000),
    videoUrl: z.string().url().max(2000).optional(),
    videoMinDurationSeconds: z.number().int().min(0).max(3600).default(60),
    isActive: z.boolean().default(false),
    publishedAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateDriverDailyBriefingPayload = z.infer<typeof createDriverDailyBriefingSchema>;

export const updateDriverDailyBriefingSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    message: z.string().min(1).max(8000).optional(),
    videoUrl: z.string().url().max(2000).nullable().optional(),
    videoMinDurationSeconds: z.number().int().min(0).max(3600).optional(),
    isActive: z.boolean().optional(),
    publishedAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type UpdateDriverDailyBriefingPayload = z.infer<typeof updateDriverDailyBriefingSchema>;

// ---------------------------------------------------------------------------
// 3. driver_briefing_acknowledgments
// ---------------------------------------------------------------------------

export const driverBriefingAcknowledgmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  briefingId: z.string().uuid(),
  acknowledgedDate: z.string().date(),
  messageReadAt: z.string().datetime().nullable(),
  videoCompletedAt: z.string().datetime().nullable(),
  acknowledgedAt: z.string().datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type DriverBriefingAcknowledgmentDto = z.infer<typeof driverBriefingAcknowledgmentSchema>;

/**
 * The driver-app POST. driverId is resolved from the session, briefingId
 * from the active briefing of the day, acknowledgedDate from the
 * server's clock so a client clock-drift doesn't break uniqueness.
 * Fields the driver actually supplies: read/completed timestamps so the
 * audit can prove video-watch threshold was met.
 */
export const createDriverBriefingAcknowledgmentSchema = z
  .object({
    briefingId: z.string().uuid(),
    messageReadAt: z.string().datetime().optional(),
    videoCompletedAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateDriverBriefingAcknowledgmentPayload = z.infer<
  typeof createDriverBriefingAcknowledgmentSchema
>;

// ---------------------------------------------------------------------------
// 4. driver_pretrip_inspections
// ---------------------------------------------------------------------------

export const driverPretripInspectionStatusValues = ['pass', 'fail_safe', 'fail_unsafe'] as const;
export type DriverPretripInspectionStatus = (typeof driverPretripInspectionStatusValues)[number];

export const pretripInspectionItemStateValues = ['ok', 'attention', 'fail'] as const;
export type PretripInspectionItemState = (typeof pretripInspectionItemStateValues)[number];

/**
 * Per-item DVIR entry. `key` is the stable identifier ("lights",
 * "tires"); `label` is the human-readable form rendered in the app.
 * `state` rolls up into the inspection-wide status. photo_keys
 * reference job-evidence rows whose kind is one of the photo_*
 * variants, captured as part of the inspection flow.
 */
export const pretripInspectionItemSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  state: z.enum(pretripInspectionItemStateValues),
  note: z.string().max(2000).optional(),
  photoKeys: z.array(z.string().min(1).max(500)).max(20).optional(),
});
export type PretripInspectionItem = z.infer<typeof pretripInspectionItemSchema>;

export const driverPretripInspectionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  truckId: z.string().uuid(),
  shiftId: z.string().uuid().nullable(),
  status: z.enum(driverPretripInspectionStatusValues),
  items: z.array(pretripInspectionItemSchema),
  odometerMiles: z.number().int().min(0).nullable(),
  signatureDataUrl: z.string().nullable(),
  notes: z.string().nullable(),
  submittedAt: z.string().datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DriverPretripInspectionDto = z.infer<typeof driverPretripInspectionSchema>;

export const createDriverPretripInspectionSchema = z
  .object({
    truckId: z.string().uuid(),
    shiftId: z.string().uuid().optional(),
    status: z.enum(driverPretripInspectionStatusValues),
    items: z.array(pretripInspectionItemSchema).min(1).max(200),
    odometerMiles: z.number().int().min(0).max(10_000_000).optional(),
    signatureDataUrl: z.string().min(1).max(2_000_000).optional(),
    notes: z.string().max(4000).optional(),
    submittedAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateDriverPretripInspectionPayload = z.infer<
  typeof createDriverPretripInspectionSchema
>;

/**
 * Admin amends an inspection (e.g. corrects a misclassified item). The
 * truckId / driverId / shiftId stay immutable; status + items + notes
 * can be edited with an audit trail.
 */
export const updateDriverPretripInspectionSchema = z
  .object({
    status: z.enum(driverPretripInspectionStatusValues).optional(),
    items: z.array(pretripInspectionItemSchema).min(1).max(200).optional(),
    odometerMiles: z.number().int().min(0).max(10_000_000).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type UpdateDriverPretripInspectionPayload = z.infer<
  typeof updateDriverPretripInspectionSchema
>;

// ---------------------------------------------------------------------------
// 5. driver_telemetry_events
// ---------------------------------------------------------------------------

export const driverTelemetryEventKindValues = [
  'ping',
  'shift_start',
  'shift_end',
  'status_change',
  'geofence_enter',
  'geofence_exit',
  'low_battery',
  'manual',
] as const;
export type DriverTelemetryEventKind = (typeof driverTelemetryEventKindValues)[number];

export const driverTelemetryEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  shiftId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  recordedAt: z.string().datetime(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  speedMph: z.number().min(0).nullable(),
  headingDegrees: z.number().min(0).max(360).nullable(),
  accuracyMeters: z.number().min(0).nullable(),
  batteryPct: z.number().int().min(0).max(100).nullable(),
  eventKind: z.enum(driverTelemetryEventKindValues),
  payload: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type DriverTelemetryEventDto = z.infer<typeof driverTelemetryEventSchema>;

export const createDriverTelemetryEventSchema = z
  .object({
    shiftId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    recordedAt: z.string().datetime(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    speedMph: z.number().min(0).max(300).optional(),
    headingDegrees: z.number().min(0).max(360).optional(),
    accuracyMeters: z.number().min(0).max(100_000).optional(),
    batteryPct: z.number().int().min(0).max(100).optional(),
    eventKind: z.enum(driverTelemetryEventKindValues).default('ping'),
    payload: z.record(z.unknown()).optional(),
  })
  .strict();
export type CreateDriverTelemetryEventPayload = z.infer<typeof createDriverTelemetryEventSchema>;

/**
 * Telemetry is batched from the client — N events per HTTP call.
 * Capped at 500 to keep a single request bounded.
 */
export const createDriverTelemetryBatchSchema = z
  .object({
    events: z.array(createDriverTelemetryEventSchema).min(1).max(500),
  })
  .strict();
export type CreateDriverTelemetryBatchPayload = z.infer<typeof createDriverTelemetryBatchSchema>;

// ---------------------------------------------------------------------------
// 6. job_evidence
// ---------------------------------------------------------------------------

export const jobEvidenceKindValues = [
  'photo_pickup',
  'photo_dropoff',
  'photo_damage',
  'photo_hookup',
  'photo_release',
  'photo_other',
  'video_walkaround',
  'video_other',
  'signature_customer',
  'signature_driver',
  'document_scan',
  'other',
] as const;
export type JobEvidenceKind = (typeof jobEvidenceKindValues)[number];

export const jobEvidenceUploadStatusValues = ['pending', 'uploaded', 'failed'] as const;
export type JobEvidenceUploadStatus = (typeof jobEvidenceUploadStatusValues)[number];

export const jobEvidenceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  driverId: z.string().uuid().nullable(),
  shiftId: z.string().uuid().nullable(),
  kind: z.enum(jobEvidenceKindValues),
  s3Key: z.string(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  widthPx: z.number().int().min(0).nullable(),
  heightPx: z.number().int().min(0).nullable(),
  durationSeconds: z.number().min(0).nullable(),
  capturedAt: z.string().datetime().nullable(),
  uploadStatus: z.enum(jobEvidenceUploadStatusValues),
  uploadedAt: z.string().datetime().nullable(),
  failureReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type JobEvidenceDto = z.infer<typeof jobEvidenceSchema>;

/**
 * A job_evidence row enriched with short-lived presigned GET URLs for the
 * dispatch UI — the full-size asset (`downloadUrl`) and its 200x200 jpg
 * `thumbnailUrl`. All four URL fields are null while the row is still
 * `pending`; `thumbnailUrl` is also null for kinds with no thumbnail
 * (documents / other). The `*ExpiresAt` fields are unix seconds.
 */
export const jobEvidenceWithUrlSchema = jobEvidenceSchema.extend({
  downloadUrl: z.string().nullable(),
  downloadUrlExpiresAt: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
  thumbnailUrlExpiresAt: z.number().int().nullable(),
});
export type JobEvidenceWithUrlDto = z.infer<typeof jobEvidenceWithUrlSchema>;

/**
 * The driver POST to register an evidence record. The actual upload is
 * a separate presigned-URL step keyed by s3Key. uploadStatus starts at
 * 'pending' and flips to 'uploaded' via PATCH after the S3 HEAD check.
 */
export const createJobEvidenceSchema = z
  .object({
    jobId: z.string().uuid(),
    kind: z.enum(jobEvidenceKindValues),
    s3Key: z.string().min(1).max(500),
    contentType: z.string().min(1).max(120).optional(),
    sizeBytes: z.number().int().min(0).max(5_000_000_000).optional(),
    widthPx: z.number().int().min(0).max(50_000).optional(),
    heightPx: z.number().int().min(0).max(50_000).optional(),
    durationSeconds: z.number().min(0).max(7200).optional(),
    capturedAt: z.string().datetime().optional(),
    shiftId: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type CreateJobEvidencePayload = z.infer<typeof createJobEvidenceSchema>;

export const updateJobEvidenceSchema = z
  .object({
    uploadStatus: z.enum(jobEvidenceUploadStatusValues).optional(),
    uploadedAt: z.string().datetime().nullable().optional(),
    failureReason: z.string().max(2000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    sizeBytes: z.number().int().min(0).max(5_000_000_000).nullable().optional(),
    widthPx: z.number().int().min(0).max(50_000).nullable().optional(),
    heightPx: z.number().int().min(0).max(50_000).nullable().optional(),
    durationSeconds: z.number().min(0).max(7200).nullable().optional(),
  })
  .strict();
export type UpdateJobEvidencePayload = z.infer<typeof updateJobEvidenceSchema>;

// ---------------------------------------------------------------------------
// 7. job_field_payments
// ---------------------------------------------------------------------------

export const jobFieldPaymentMethodValues = [
  'card_present_tap',
  'card_present_chip',
  'card_present_swipe',
  'card_present_manual',
  'cash',
  'check',
  'other',
] as const;
export type JobFieldPaymentMethod = (typeof jobFieldPaymentMethodValues)[number];

export const jobFieldPaymentStatusValues = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'canceled',
] as const;
export type JobFieldPaymentStatus = (typeof jobFieldPaymentStatusValues)[number];

export const jobFieldPaymentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  driverId: z.string().uuid().nullable(),
  shiftId: z.string().uuid().nullable(),
  amountCents: z.number().int().min(0),
  tipCents: z.number().int().min(0),
  currency: z.string(),
  paymentMethod: z.enum(jobFieldPaymentMethodValues),
  stripePaymentIntentId: z.string().nullable(),
  stripeTerminalReaderId: z.string().nullable(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  status: z.enum(jobFieldPaymentStatusValues),
  authorizedAt: z.string().datetime().nullable(),
  capturedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  failureReason: z.string().nullable(),
  receiptEmail: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  clientIdempotencyKey: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type JobFieldPaymentDto = z.infer<typeof jobFieldPaymentSchema>;

export const createJobFieldPaymentSchema = z
  .object({
    jobId: z.string().uuid(),
    amountCents: z.number().int().min(0).max(100_000_000),
    tipCents: z.number().int().min(0).max(100_000_000).default(0),
    currency: z
      .string()
      .regex(/^[a-z]{3}$/, 'currency must be a 3-letter ISO code')
      .default('usd'),
    paymentMethod: z.enum(jobFieldPaymentMethodValues),
    stripeTerminalReaderId: z.string().max(120).optional(),
    receiptEmail: z.string().email().max(254).optional(),
    clientIdempotencyKey: z.string().min(8).max(120).optional(),
    shiftId: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type CreateJobFieldPaymentPayload = z.infer<typeof createJobFieldPaymentSchema>;

export const updateJobFieldPaymentSchema = z
  .object({
    status: z.enum(jobFieldPaymentStatusValues).optional(),
    stripePaymentIntentId: z.string().max(120).nullable().optional(),
    cardBrand: z.string().max(40).nullable().optional(),
    cardLast4: z
      .string()
      .regex(/^\d{4}$/, 'cardLast4 must be 4 digits')
      .nullable()
      .optional(),
    authorizedAt: z.string().datetime().nullable().optional(),
    capturedAt: z.string().datetime().nullable().optional(),
    failedAt: z.string().datetime().nullable().optional(),
    failureReason: z.string().max(2000).nullable().optional(),
    receiptUrl: z.string().url().max(2000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateJobFieldPaymentPayload = z.infer<typeof updateJobFieldPaymentSchema>;

// ---------------------------------------------------------------------------
// 8. driver_offline_actions
// ---------------------------------------------------------------------------

export const driverOfflineActionStatusValues = ['pending', 'applied', 'failed', 'skipped'] as const;
export type DriverOfflineActionStatus = (typeof driverOfflineActionStatusValues)[number];

/**
 * Known action kinds in build 1. Stored as text in Postgres so future
 * additions don't need an ALTER TYPE migration; Zod is the API-side
 * gate so we get IDE help and clear errors for the supported set.
 */
export const driverOfflineActionKindValues = [
  'job_status_transition',
  'submit_pretrip',
  'acknowledge_briefing',
  'upload_evidence',
  'capture_field_payment',
  'shift_clock_on',
  'shift_clock_off',
  'note_add',
] as const;
export type DriverOfflineActionKind = (typeof driverOfflineActionKindValues)[number];

export const driverOfflineActionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  driverId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  shiftId: z.string().uuid().nullable(),
  actionKind: z.string(),
  payload: z.record(z.unknown()),
  clientTimestamp: z.string().datetime(),
  clientEventUuid: z.string().uuid(),
  status: z.enum(driverOfflineActionStatusValues),
  appliedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  failureReason: z.string().nullable(),
  attemptCount: z.number().int().min(0),
  receivedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DriverOfflineActionDto = z.infer<typeof driverOfflineActionSchema>;

export const createDriverOfflineActionSchema = z
  .object({
    actionKind: z.enum(driverOfflineActionKindValues),
    payload: z.record(z.unknown()).default({}),
    clientTimestamp: z.string().datetime(),
    clientEventUuid: z.string().uuid(),
    jobId: z.string().uuid().optional(),
    shiftId: z.string().uuid().optional(),
  })
  .strict();
export type CreateDriverOfflineActionPayload = z.infer<typeof createDriverOfflineActionSchema>;

/**
 * Replay batch. Client posts N pending actions on reconnect; server
 * de-dupes by client_event_uuid and applies in clientTimestamp order.
 */
export const createDriverOfflineActionBatchSchema = z
  .object({
    actions: z.array(createDriverOfflineActionSchema).min(1).max(200),
  })
  .strict();
export type CreateDriverOfflineActionBatchPayload = z.infer<
  typeof createDriverOfflineActionBatchSchema
>;
