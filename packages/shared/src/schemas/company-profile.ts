/**
 * Company Profile — the 17 locked fields stored inside tenants.settings (jsonb).
 *
 * Field map (spec — Admin Settings build 7 of 7):
 *
 *   Legal Business Name   → tenants.name           (column)
 *   DBA / Brand Name      → settings.dba_name
 *   Federal EIN           → settings.federal_ein
 *   State License #       → settings.state_license_number
 *   MC / DOT Number       → settings.mc_dot_number
 *   Physical Address      → settings.physical_address      (structured)
 *   Mailing Address       → settings.mailing_address       (structured)
 *   Phone                 → settings.phone                 (E.164)
 *   Email                 → settings.email
 *   Website               → settings.website
 *   Logo                  → settings.logo_url
 *   Brand Color           → settings.brand_color
 *   Business Hours        → settings.business_hours        (7-day structured)
 *   Timezone              → settings.timezone              (IANA)
 *   Owner Name            → settings.owner_name
 *   Owner Mobile          → settings.owner_mobile          (E.164)
 *   Default Lien State    → settings.default_lien_state    (2-letter US)
 *
 * Storage philosophy: all the new fields live under tenants.settings so the
 * tenants table itself stays a slim FK target. The PATCH /tenants/current
 * endpoint deep-merges incoming settings on top of existing settings, so
 * partial updates do not blow away unrelated keys. On the first save (when
 * tenants.settings has no physical_address yet) the full required set must
 * be present; subsequent saves can partial-patch any subset.
 */
import { z } from 'zod';

const US_STATE_VALUES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
] as const;

export const US_STATES = US_STATE_VALUES;
export type UsState = (typeof US_STATE_VALUES)[number];

/** Stored as E.164. Loose check: leading '+', 8–15 digits total. */
const e164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format (e.g. +15551234567)');

/** Stored as the literal "##-#######" the IRS prints. */
const einSchema = z
  .string()
  .regex(/^\d{2}-\d{7}$/, 'EIN must be formatted NN-NNNNNNN');

/** 5-digit or 5+4 ZIP. */
const zipSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'ZIP must be 5 digits or 5+4');

/** Hex RGB with leading "#". */
const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Brand color must be a 6-digit hex code like #1E40AF');

/** HH:MM 24-hour. */
const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)');

export const addressSchema = z.object({
  street_1: z.string().min(1).max(120),
  street_2: z.string().max(120).optional(),
  city: z.string().min(1).max(80),
  state: z.enum(US_STATE_VALUES),
  zip: zipSchema,
});

export type CompanyAddress = z.infer<typeof addressSchema>;

const dayHoursSchema = z
  .object({
    closed: z.boolean(),
    open: hhmmSchema.optional(),
    close: hhmmSchema.optional(),
  })
  .refine(
    (d) => d.closed || (d.open !== undefined && d.close !== undefined),
    'Open and close times are required unless the day is marked closed',
  );

export const businessHoursSchema = z.object({
  monday: dayHoursSchema,
  tuesday: dayHoursSchema,
  wednesday: dayHoursSchema,
  thursday: dayHoursSchema,
  friday: dayHoursSchema,
  saturday: dayHoursSchema,
  sunday: dayHoursSchema,
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

/**
 * The complete company profile stored under tenants.settings. The
 * Legal Business Name lives on tenants.name and is NOT part of this
 * schema — see CompanyProfilePatchPayload below for the combined
 * write payload.
 *
 * URL fields are stored as raw strings (not z.string().url()) so the
 * form can persist partial typing while a user is editing. The web
 * form's RHF validator can be stricter; the API only refuses obviously
 * malformed entries.
 */
export const companyProfileSettingsSchema = z.object({
  dba_name: z.string().max(120).optional(),
  federal_ein: einSchema,
  state_license_number: z.string().min(1).max(60),
  mc_dot_number: z.string().max(60).optional(),
  physical_address: addressSchema,
  mailing_address: addressSchema.optional(),
  phone: e164Schema,
  email: z.string().email().max(254),
  website: z.string().max(255).optional(),
  logo_url: z.string().max(2048).optional(),
  brand_color: hexColorSchema.optional(),
  business_hours: businessHoursSchema,
  timezone: z.string().min(1).max(64),
  owner_name: z.string().min(1).max(120),
  owner_mobile: e164Schema,
  default_lien_state: z.enum(US_STATE_VALUES),
});

export type CompanyProfileSettings = z.infer<typeof companyProfileSettingsSchema>;

/**
 * Partial-update variant. The service treats the payload as a deep-merge
 * patch on top of existing settings; missing keys are NOT cleared. Use
 * this for any save AFTER the first complete save.
 */
export const companyProfileSettingsPartialSchema = companyProfileSettingsSchema
  .partial()
  // Reject {} entirely — calling PATCH with no settings is fine, but a
  // settings object explicitly set to empty would clear nothing yet still
  // trip validation; surfacing the no-op is friendlier than a silent 200.
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');

export type CompanyProfileSettingsPartial = z.infer<typeof companyProfileSettingsPartialSchema>;

/**
 * Combined write payload: name (-> tenants.name) plus the settings patch.
 * Both top-level keys are optional so the page can patch just the name,
 * or just the settings, or both in one call.
 */
export const companyProfilePatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    settings: companyProfileSettingsPartialSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.settings !== undefined,
    'Provide name, settings, or both',
  );

export type CompanyProfilePatchPayload = z.infer<typeof companyProfilePatchSchema>;
