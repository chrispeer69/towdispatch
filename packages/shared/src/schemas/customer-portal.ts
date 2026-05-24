/**
 * Customer portal contracts (White-Label Customer Portal — Session 32).
 *
 * The customer-facing portal is host-scoped: the tenant is resolved from the
 * request Host (custom domain or <slug>.portal.<base>) BEFORE any login, so
 * signup/login/forgot/reset all operate within one already-resolved tenant.
 * Auth is fully separate from staff (`customer_portal_users`, distinct JWT
 * audience/secret/guard).
 *
 * Wire conventions: timestamps ISO-8601 strings; money integer cents.
 *
 * Cross-customer isolation (a portal user only ever sees their own customer's
 * jobs/invoices) is enforced server-side in PortalAccountService — these
 * contracts never carry another customer's data.
 */
import { z } from 'zod';
import { emailSchema, passwordSchema } from './user';

// ---------------------------------------------------------------------------
// Host resolution + branding (public, pre-login)
// ---------------------------------------------------------------------------

/** Branding the portal renders before a customer is authenticated. */
export const portalBrandingSchema = z.object({
  tenantName: z.string(),
  tenantSlug: z.string(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  accentColor: z.string().nullable(),
  supportEmail: z.string().nullable(),
  supportPhone: z.string().nullable(),
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
});
export type PortalBrandingDto = z.infer<typeof portalBrandingSchema>;

/** GET /portal/public/resolve?host=... */
export const portalResolveResponseSchema = z.object({
  branding: portalBrandingSchema,
});
export type PortalResolveResponse = z.infer<typeof portalResolveResponseSchema>;

// ---------------------------------------------------------------------------
// Auth payloads (tenant resolved from Host header server-side)
// ---------------------------------------------------------------------------

export const portalSignupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type PortalSignupPayload = z.infer<typeof portalSignupSchema>;

export const portalLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type PortalLoginPayload = z.infer<typeof portalLoginSchema>;

export const portalForgotPasswordSchema = z.object({
  email: emailSchema,
});
export type PortalForgotPasswordPayload = z.infer<typeof portalForgotPasswordSchema>;

export const portalResetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: passwordSchema,
});
export type PortalResetPasswordPayload = z.infer<typeof portalResetPasswordSchema>;

export const portalVerifyEmailSchema = z.object({
  token: z.string().min(1).max(512),
});
export type PortalVerifyEmailPayload = z.infer<typeof portalVerifyEmailSchema>;

/** Identity returned by /portal/login and /portal/me. */
export const portalUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  customerName: z.string(),
  emailVerified: z.boolean(),
});
export type PortalUserDto = z.infer<typeof portalUserSchema>;

export const portalAuthResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: portalUserSchema,
});
export type PortalAuthResponse = z.infer<typeof portalAuthResponseSchema>;

/**
 * Signup/forgot-password always answer with this neutral shape regardless of
 * whether a matching customer / account existed — no account enumeration.
 */
export const portalGenericOkSchema = z.object({
  ok: z.literal(true),
});
export type PortalGenericOk = z.infer<typeof portalGenericOkSchema>;

// ---------------------------------------------------------------------------
// Jobs (authenticated, scoped to the portal user's customer)
// ---------------------------------------------------------------------------

export const portalJobStatusValues = [
  'new',
  'dispatched',
  'enroute',
  'on_scene',
  'in_progress',
  'completed',
  'cancelled',
  'goa',
] as const;

export const portalJobSummarySchema = z.object({
  id: z.string().uuid(),
  jobNumber: z.string(),
  status: z.enum(portalJobStatusValues),
  serviceType: z.string(),
  pickupAddress: z.string(),
  dropoffAddress: z.string().nullable(),
  createdAt: z.string().datetime(),
  assignedAt: z.string().datetime().nullable(),
});
export type PortalJobSummaryDto = z.infer<typeof portalJobSummarySchema>;

export const portalJobListResponseSchema = z.object({
  jobs: z.array(portalJobSummarySchema),
});
export type PortalJobListResponse = z.infer<typeof portalJobListResponseSchema>;

/** A driver, redacted: name + optional photo only. Never phone/PII. */
export const portalDriverSchema = z.object({
  name: z.string(),
  photoUrl: z.string().nullable(),
});
export type PortalDriverDto = z.infer<typeof portalDriverSchema>;

/** Invoice as the customer sees it. No internal notes. */
export const portalInvoiceSummarySchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  status: z.string(),
  totalCents: z.number().int(),
  paidCents: z.number().int(),
  balanceCents: z.number().int(),
  currency: z.string(),
  issuedAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  /** True when the balance is payable online (issued/overdue + balance > 0). */
  payable: z.boolean(),
});
export type PortalInvoiceSummaryDto = z.infer<typeof portalInvoiceSummarySchema>;

export const portalJobDetailSchema = z.object({
  id: z.string().uuid(),
  jobNumber: z.string(),
  status: z.enum(portalJobStatusValues),
  serviceType: z.string(),
  pickupAddress: z.string(),
  dropoffAddress: z.string().nullable(),
  createdAt: z.string().datetime(),
  assignedAt: z.string().datetime().nullable(),
  driver: portalDriverSchema.nullable(),
  evidencePhotoUrls: z.array(z.string()),
  invoice: portalInvoiceSummarySchema.nullable(),
});
export type PortalJobDetailDto = z.infer<typeof portalJobDetailSchema>;

export const portalInvoiceListResponseSchema = z.object({
  invoices: z.array(portalInvoiceSummarySchema),
});
export type PortalInvoiceListResponse = z.infer<typeof portalInvoiceListResponseSchema>;

/**
 * POST /portal/invoices/:id/pay-link — returns the absolute URL of the
 * existing public pay page (/pay/<token>), which already renders Stripe
 * Elements and respects PAYMENTS_PROVIDER. The portal never touches Stripe
 * directly.
 */
export const portalPayLinkResponseSchema = z.object({
  payUrl: z.string().url(),
});
export type PortalPayLinkResponse = z.infer<typeof portalPayLinkResponseSchema>;
