/**
 * System-default templates for every event type the dispatcher accepts.
 *
 * These ship with the platform and are loaded into notification_templates
 * (tenant_id IS NULL) on first boot via the TemplateLoader. Tenants override
 * by inserting a sibling row with their tenant_id; the resolver picks the
 * tenant row when present.
 *
 * Channel conventions:
 *   * push  — `subject` is the notification title (max ~50 chars),
 *             `body` is the notification body (max ~240 chars). Both
 *             rendered with Handlebars; no HTML.
 *   * sms   — `subject` ignored, `body` is the SMS body (<= 160 chars
 *             ideal, longer fine but billed as multiple segments).
 *   * email — `subject` is the email subject, `body` is HTML,
 *             `bodyPlain` is the plain-text alternative.
 *   * in_app — `subject` is the card heading, `body` is the card body.
 *   * webhook — `subject` ignored, `body` is the JSON template (Handlebars
 *             over the payload — usually `{{json this}}` to dump verbatim).
 *
 * Variables: every template uses Handlebars {{variable}} syntax. The list
 * of well-known variables per event lives in variables_schema (an array of
 * { key, example } objects) and drives the admin preview form.
 */
import { NOTIFICATION_EVENTS, type NotificationChannel } from '@ustowdispatch/shared';

export interface SystemTemplate {
  templateKey: string;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  bodyPlain: string | null;
  variablesSchema: ReadonlyArray<{ key: string; example: unknown }>;
}

/* Helpers for email HTML — kept minimal because tenants override anyway. */
function emailLayout(title: string, content: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f7f8;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
<h1 style="font-size:20px;color:#1A1E2A;margin:0 0 12px 0;">${title}</h1>
${content}
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
<p style="font-size:12px;color:#666;margin:0;">Sent by US Tow Dispatch Pro · You are receiving this because you have a US Tow Dispatch account.</p>
</div></body></html>`;
}

const VARS_JOB: ReadonlyArray<{ key: string; example: unknown }> = [
  { key: 'jobNumber', example: 'J-2026-00472' },
  { key: 'serviceType', example: 'Light-duty tow' },
  { key: 'pickupAddress', example: '123 Main St, Springfield' },
  { key: 'driverName', example: 'Sam W.' },
  { key: 'driverUnit', example: 'T-04' },
  { key: 'tenantName', example: 'Apex Towing' },
  { key: 'etaMinutes', example: 12 },
  { key: 'trackingUrl', example: 'https://towcommand.com/t/abc123' },
  { key: 'customerName', example: 'Acme Auto' },
];

const VARS_BILLING: ReadonlyArray<{ key: string; example: unknown }> = [
  { key: 'invoiceNumber', example: 'INV-1042' },
  { key: 'amountFormatted', example: '$285.50' },
  { key: 'balanceFormatted', example: '$285.50' },
  { key: 'dueDate', example: '2026-06-01' },
  { key: 'invoiceUrl', example: 'https://towcommand.com/billing/inv-1042' },
  { key: 'tenantName', example: 'Apex Towing' },
];

const VARS_COMPLIANCE: ReadonlyArray<{ key: string; example: unknown }> = [
  { key: 'driverName', example: 'Sam W.' },
  { key: 'documentType', example: 'CDL' },
  { key: 'expiresOn', example: '2026-05-31' },
  { key: 'daysUntilExpiry', example: 7 },
  { key: 'tenantName', example: 'Apex Towing' },
];

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  // ===== DISPATCH =====
  {
    templateKey: NOTIFICATION_EVENTS.JOB_ASSIGNED,
    channel: 'push',
    subject: 'New Job Assigned',
    body: '{{serviceType}} · {{pickupAddress}} · ETA {{etaMinutes}}m',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_ASSIGNED,
    channel: 'in_app',
    subject: 'New job assigned',
    body: 'Job {{jobNumber}} ({{serviceType}}) was assigned to you. Pickup: {{pickupAddress}}.',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_ACCEPTED,
    channel: 'in_app',
    subject: 'Driver accepted',
    body: '{{driverName}} ({{driverUnit}}) accepted job {{jobNumber}}.',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_DECLINED,
    channel: 'in_app',
    subject: 'Driver declined',
    body: '{{driverName}} declined job {{jobNumber}}. Reason: {{reason}}',
    bodyPlain: null,
    variablesSchema: [...VARS_JOB, { key: 'reason', example: 'Already on a long-distance tow.' }],
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_STATUS_CHANGED,
    channel: 'in_app',
    subject: 'Job status update',
    body: 'Job {{jobNumber}} is now {{newStatus}}.',
    bodyPlain: null,
    variablesSchema: [
      ...VARS_JOB,
      { key: 'newStatus', example: 'on_scene' },
      { key: 'previousStatus', example: 'en_route' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_GOA_FLAGGED,
    channel: 'in_app',
    subject: 'GOA flagged',
    body: 'Driver flagged job {{jobNumber}} as Gone On Arrival.',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_GOA_FLAGGED,
    channel: 'push',
    subject: 'GOA flagged',
    body: '{{driverName}} flagged job {{jobNumber}} as GOA.',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.JOB_CANCELLED_BY_CUSTOMER,
    channel: 'in_app',
    subject: 'Customer cancelled',
    body: 'Customer cancelled job {{jobNumber}}. {{cancelReason}}',
    bodyPlain: null,
    variablesSchema: [...VARS_JOB, { key: 'cancelReason', example: 'Customer found other help' }],
  },

  // ===== MOTOR CLUB =====
  {
    templateKey: NOTIFICATION_EVENTS.MOTOR_CLUB_JOB_RECEIVED,
    channel: 'push',
    subject: 'Motor Club Job',
    body: '{{motorClub}} sent a new job — {{serviceType}} at {{pickupAddress}}.',
    bodyPlain: null,
    variablesSchema: [...VARS_JOB, { key: 'motorClub', example: 'Agero' }],
  },
  {
    templateKey: NOTIFICATION_EVENTS.MOTOR_CLUB_JOB_RECEIVED,
    channel: 'in_app',
    subject: 'New motor club job',
    body: '{{motorClub}} dispatched job {{jobNumber}} — {{serviceType}} at {{pickupAddress}}.',
    bodyPlain: null,
    variablesSchema: [...VARS_JOB, { key: 'motorClub', example: 'Agero' }],
  },
  {
    templateKey: NOTIFICATION_EVENTS.MOTOR_CLUB_SYNC_FAILURE,
    channel: 'in_app',
    subject: 'Motor club sync failed',
    body: 'Failed to push update to {{motorClub}} for job {{jobNumber}}: {{errorReason}}',
    bodyPlain: null,
    variablesSchema: [
      ...VARS_JOB,
      { key: 'motorClub', example: 'Agero' },
      { key: 'errorReason', example: '401 unauthorized — credential rotation required' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.MOTOR_CLUB_ETA_PUSHED,
    channel: 'in_app',
    subject: 'ETA updated',
    body: 'ETA for job {{jobNumber}} pushed to {{motorClub}}: {{etaMinutes}} min.',
    bodyPlain: null,
    variablesSchema: [...VARS_JOB, { key: 'motorClub', example: 'Agero' }],
  },

  // ===== CUSTOMER-FACING =====
  {
    templateKey: NOTIFICATION_EVENTS.CUSTOMER_TOW_DISPATCHED,
    channel: 'sms',
    subject: null,
    body: '{{tenantName}}: your tow truck is on the way. Track live: {{trackingUrl}}',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.CUSTOMER_DRIVER_EN_ROUTE,
    channel: 'sms',
    subject: null,
    body: '{{driverName}} ({{driverUnit}}) is en route. ETA {{etaMinutes}} min. Track: {{trackingUrl}}',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.CUSTOMER_DRIVER_ARRIVED,
    channel: 'sms',
    subject: null,
    body: 'Your driver {{driverName}} has arrived. Please meet them at the vehicle. — {{tenantName}}',
    bodyPlain: null,
    variablesSchema: VARS_JOB,
  },
  {
    templateKey: NOTIFICATION_EVENTS.CUSTOMER_PAYMENT_RECEIPT,
    channel: 'email',
    subject: 'Receipt from {{tenantName}}',
    body: emailLayout(
      'Payment received',
      `<p>Thank you, {{customerName}}.</p>
<p>We received {{amountFormatted}} for job {{jobNumber}}.</p>
<p>Reference: <strong>{{paymentReference}}</strong></p>`,
    ),
    bodyPlain: `Thank you, {{customerName}}.

We received {{amountFormatted}} for job {{jobNumber}}.
Reference: {{paymentReference}}`,
    variablesSchema: [
      ...VARS_BILLING,
      { key: 'paymentReference', example: 'PR-2026-04-118' },
      { key: 'amountFormatted', example: '$285.50' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.CUSTOMER_PAYMENT_RECEIPT,
    channel: 'sms',
    subject: null,
    body: '{{tenantName}}: payment of {{amountFormatted}} received for job {{jobNumber}}. Thank you.',
    bodyPlain: null,
    variablesSchema: VARS_BILLING,
  },

  // ===== BILLING =====
  {
    templateKey: NOTIFICATION_EVENTS.BILLING_INVOICE_CREATED,
    channel: 'email',
    subject: 'Invoice {{invoiceNumber}} from {{tenantName}}',
    body: emailLayout(
      'Invoice {{invoiceNumber}}',
      `<p>{{tenantName}} has issued invoice <strong>{{invoiceNumber}}</strong> for {{amountFormatted}}.</p>
<p>Balance due: <strong>{{balanceFormatted}}</strong> by {{dueDate}}.</p>
<p><a href="{{invoiceUrl}}" style="background:#F05A1A;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block;">View invoice</a></p>`,
    ),
    bodyPlain: `{{tenantName}} has issued invoice {{invoiceNumber}} for {{amountFormatted}}.
Balance due: {{balanceFormatted}} by {{dueDate}}.
View: {{invoiceUrl}}`,
    variablesSchema: VARS_BILLING,
  },
  {
    templateKey: NOTIFICATION_EVENTS.BILLING_INVOICE_PAID,
    channel: 'email',
    subject: 'Payment received — invoice {{invoiceNumber}}',
    body: emailLayout(
      'Payment received',
      '<p>We received your payment of {{amountFormatted}} for invoice {{invoiceNumber}}. Thank you.</p>',
    ),
    bodyPlain: 'Payment of {{amountFormatted}} received for invoice {{invoiceNumber}}. Thank you.',
    variablesSchema: VARS_BILLING,
  },
  {
    templateKey: NOTIFICATION_EVENTS.BILLING_INVOICE_PAID,
    channel: 'in_app',
    subject: 'Invoice paid',
    body: 'Invoice {{invoiceNumber}} ({{amountFormatted}}) was paid.',
    bodyPlain: null,
    variablesSchema: VARS_BILLING,
  },
  {
    templateKey: NOTIFICATION_EVENTS.BILLING_PAYMENT_FAILED,
    channel: 'email',
    subject: 'Payment attempt failed for invoice {{invoiceNumber}}',
    body: emailLayout(
      'Payment failed',
      `<p>Your auto-charge attempt for invoice {{invoiceNumber}} ({{amountFormatted}}) failed.</p>
<p>Reason: <em>{{failureReason}}</em></p>
<p>Please <a href="{{invoiceUrl}}">update your card on file</a>.</p>`,
    ),
    bodyPlain: `Payment failed for invoice {{invoiceNumber}} ({{amountFormatted}}).
Reason: {{failureReason}}
Update card: {{invoiceUrl}}`,
    variablesSchema: [...VARS_BILLING, { key: 'failureReason', example: 'card_declined' }],
  },
  {
    templateKey: NOTIFICATION_EVENTS.BILLING_CARD_EXPIRING,
    channel: 'email',
    subject: 'Card on file is expiring',
    body: emailLayout(
      'Card on file expiring',
      `<p>The card ending {{cardLast4}} ({{cardBrand}}) expires {{cardExpMonth}}/{{cardExpYear}}.</p>
<p>Update it before the next auto-charge.</p>`,
    ),
    bodyPlain: 'Card ending {{cardLast4}} expires {{cardExpMonth}}/{{cardExpYear}}. Please update.',
    variablesSchema: [
      ...VARS_BILLING,
      { key: 'cardLast4', example: '4242' },
      { key: 'cardBrand', example: 'Visa' },
      { key: 'cardExpMonth', example: 6 },
      { key: 'cardExpYear', example: 2026 },
    ],
  },

  // ===== COMPLIANCE =====
  {
    templateKey: NOTIFICATION_EVENTS.COMPLIANCE_LICENSE_EXPIRING,
    channel: 'email',
    subject: '{{driverName}}: driver license expires in {{daysUntilExpiry}} days',
    body: emailLayout(
      'License expiring',
      `<p>Driver license for <strong>{{driverName}}</strong> expires on {{expiresOn}} ({{daysUntilExpiry}} days).</p>
<p>Renew and upload the new document to keep dispatch eligibility.</p>`,
    ),
    bodyPlain:
      'License for {{driverName}} expires {{expiresOn}} ({{daysUntilExpiry}}d). Renew and upload.',
    variablesSchema: VARS_COMPLIANCE,
  },
  {
    templateKey: NOTIFICATION_EVENTS.COMPLIANCE_LICENSE_EXPIRING,
    channel: 'in_app',
    subject: 'License expiring',
    body: "{{driverName}}'s license expires in {{daysUntilExpiry}} days.",
    bodyPlain: null,
    variablesSchema: VARS_COMPLIANCE,
  },
  {
    templateKey: NOTIFICATION_EVENTS.COMPLIANCE_MEDICAL_CARD_EXPIRING,
    channel: 'email',
    subject: 'Medical card expiring for {{driverName}}',
    body: emailLayout(
      'Medical card expiring',
      `<p>{{driverName}}'s DOT medical card expires {{expiresOn}} ({{daysUntilExpiry}} days). Schedule the renewal exam now.</p>`,
    ),
    bodyPlain: 'Medical card for {{driverName}} expires {{expiresOn}}.',
    variablesSchema: VARS_COMPLIANCE,
  },
  {
    templateKey: NOTIFICATION_EVENTS.COMPLIANCE_COI_EXPIRING,
    channel: 'email',
    subject: 'COI expiring on {{expiresOn}}',
    body: emailLayout(
      'COI expiring',
      '<p>Certificate of Insurance expires {{expiresOn}}. Upload the renewed COI before that date to avoid coverage gaps.</p>',
    ),
    bodyPlain: 'COI expires {{expiresOn}}.',
    variablesSchema: VARS_COMPLIANCE,
  },
  {
    templateKey: NOTIFICATION_EVENTS.COMPLIANCE_MOTOR_CLUB_CRED_EXPIRING,
    channel: 'email',
    subject: '{{motorClub}} credentials expiring',
    body: emailLayout(
      'Motor club credentials expiring',
      '<p>Your {{motorClub}} credentials expire on {{expiresOn}}. Rotate before then to avoid sync failures.</p>',
    ),
    bodyPlain: '{{motorClub}} creds expire {{expiresOn}}.',
    variablesSchema: [...VARS_COMPLIANCE, { key: 'motorClub', example: 'Agero' }],
  },
  {
    templateKey: NOTIFICATION_EVENTS.COMPLIANCE_DVIR_DEFECT_FLAGGED,
    channel: 'in_app',
    subject: 'DVIR defect flagged',
    body: '{{driverName}} flagged a {{severity}} defect on {{truckUnit}}: {{defectDescription}}',
    bodyPlain: null,
    variablesSchema: [
      ...VARS_COMPLIANCE,
      { key: 'severity', example: 'critical' },
      { key: 'truckUnit', example: 'T-04' },
      { key: 'defectDescription', example: 'Brake light out, driver side' },
    ],
  },

  // ===== SYSTEM =====
  {
    templateKey: NOTIFICATION_EVENTS.SYSTEM_REPORT_SCHEDULED_DELIVERY,
    channel: 'email',
    subject: '{{reportName}} — {{periodLabel}}',
    body: emailLayout(
      'Scheduled report',
      `<p>Your scheduled report <strong>{{reportName}}</strong> for {{periodLabel}} is attached / linked below.</p>
<p><a href="{{reportUrl}}">View report</a></p>`,
    ),
    bodyPlain: '{{reportName}} for {{periodLabel}}: {{reportUrl}}',
    variablesSchema: [
      { key: 'reportName', example: 'Weekly dispatch summary' },
      { key: 'periodLabel', example: '2026-04-29 — 2026-05-05' },
      { key: 'reportUrl', example: 'https://towcommand.com/reporting/sched/abc' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.SYSTEM_INTEGRATION_AUTH_FAILURE,
    channel: 'in_app',
    subject: '{{integrationName}} authentication failed',
    body: '{{integrationName}} returned an auth error ({{errorReason}}). Reconnect to resume sync.',
    bodyPlain: null,
    variablesSchema: [
      { key: 'integrationName', example: 'QuickBooks Online' },
      { key: 'errorReason', example: 'invalid_grant' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.SYSTEM_INTEGRATION_AUTH_FAILURE,
    channel: 'email',
    subject: '{{integrationName}} reconnect required',
    body: emailLayout(
      'Integration reconnect required',
      '<p>{{integrationName}} reported <code>{{errorReason}}</code>. Reconnect in US Tow Dispatch → Integrations to resume sync.</p>',
    ),
    bodyPlain: '{{integrationName}}: {{errorReason}}. Reconnect required.',
    variablesSchema: [
      { key: 'integrationName', example: 'QuickBooks Online' },
      { key: 'errorReason', example: 'invalid_grant' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.SYSTEM_SECURITY_EVENT,
    channel: 'email',
    subject: 'Security alert: {{eventLabel}}',
    body: emailLayout(
      'Security event',
      `<p><strong>{{eventLabel}}</strong> on your US Tow Dispatch account.</p>
<p>Device: {{userAgent}}<br/>IP: {{ipAddress}}<br/>When: {{occurredAt}}</p>
<p>If this was not you, change your password and contact support.</p>`,
    ),
    bodyPlain: `{{eventLabel}} on your US Tow Dispatch account.
Device: {{userAgent}}
IP: {{ipAddress}}
When: {{occurredAt}}`,
    variablesSchema: [
      { key: 'eventLabel', example: 'New device login' },
      { key: 'userAgent', example: 'Chrome 128 / macOS 14' },
      { key: 'ipAddress', example: '203.0.113.5' },
      { key: 'occurredAt', example: '2026-05-11T14:21:00Z' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.SYSTEM_SECURITY_EVENT,
    channel: 'in_app',
    subject: 'Security alert',
    body: '{{eventLabel}} ({{ipAddress}}, {{userAgent}}).',
    bodyPlain: null,
    variablesSchema: [
      { key: 'eventLabel', example: 'New device login' },
      { key: 'ipAddress', example: '203.0.113.5' },
      { key: 'userAgent', example: 'Chrome 128 / macOS 14' },
    ],
  },

  // ===== OPERATIONAL (Phase 3 — wired now) =====
  {
    templateKey: NOTIFICATION_EVENTS.OPS_LIEN_DEADLINE_APPROACHING,
    channel: 'in_app',
    subject: 'Lien deadline',
    body: 'Lien process for vehicle {{vehicleLabel}} hits {{deadlineLabel}} in {{daysUntilDeadline}} days.',
    bodyPlain: null,
    variablesSchema: [
      { key: 'vehicleLabel', example: '2019 Toyota Camry · VIN ABC123' },
      { key: 'deadlineLabel', example: 'first notice' },
      { key: 'daysUntilDeadline', example: 5 },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.OPS_HOLD_VEHICLE_RELEASE_APPROVED,
    channel: 'in_app',
    subject: 'Release approved',
    body: 'Release of {{vehicleLabel}} approved by {{approverName}}.',
    bodyPlain: null,
    variablesSchema: [
      { key: 'vehicleLabel', example: '2019 Toyota Camry' },
      { key: 'approverName', example: 'D. Holloway' },
    ],
  },
  {
    templateKey: NOTIFICATION_EVENTS.OPS_AUCTION_LOT_EXPIRING,
    channel: 'in_app',
    subject: 'Auction lot expiring',
    body: 'Lot #{{lotNumber}} expires {{expiresOn}}.',
    bodyPlain: null,
    variablesSchema: [
      { key: 'lotNumber', example: 'L-2026-117' },
      { key: 'expiresOn', example: '2026-06-15' },
    ],
  },

  // ===== WEBHOOK CATCH-ALL =====
  // One generic webhook template used for every event when no override exists.
  // Tenants may override per-event for a custom JSON shape.
  {
    templateKey: '__webhook_default__',
    channel: 'webhook',
    subject: null,
    body: '{"event":"{{eventType}}","data":{{{jsonPayload}}},"occurredAt":"{{occurredAt}}"}',
    bodyPlain: null,
    variablesSchema: [
      { key: 'eventType', example: 'dispatch.job_assigned' },
      { key: 'jsonPayload', example: '{}' },
      { key: 'occurredAt', example: '2026-05-11T14:21:00Z' },
    ],
  },
];
