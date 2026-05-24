/**
 * SCIM 2.0 resource contracts (RFC 7643 / 7644) — Session 38.
 *
 * Inbound schemas (what an IdP POSTs/PUTs) are deliberately permissive:
 * IdPs vary wildly in which optional attributes they send, and SCIM says a
 * server must ignore unknown attributes rather than 400. Outbound schemas
 * (what we return) are the canonical shape.
 */
import { z } from 'zod';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

// ---------- shared sub-objects ----------
export const scimNameSchema = z
  .object({
    formatted: z.string().optional(),
    givenName: z.string().optional(),
    familyName: z.string().optional(),
  })
  .passthrough();

export const scimEmailSchema = z
  .object({
    value: z.string(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  })
  .passthrough();

export const scimMetaSchema = z.object({
  resourceType: z.string(),
  created: z.string().datetime().optional(),
  lastModified: z.string().datetime().optional(),
  location: z.string().optional(),
});

// ---------- inbound (IdP -> us) ----------
export const scimUserInputSchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    externalId: z.string().max(512).optional(),
    userName: z.string().min(1).max(320),
    name: scimNameSchema.optional(),
    displayName: z.string().optional(),
    emails: z.array(scimEmailSchema).optional(),
    active: z.boolean().optional(),
  })
  .passthrough();
export type ScimUserInput = z.infer<typeof scimUserInputSchema>;

export const scimGroupInputSchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    externalId: z.string().max(512).optional(),
    displayName: z.string().min(1).max(320),
    members: z.array(z.object({ value: z.string() }).passthrough()).optional(),
  })
  .passthrough();
export type ScimGroupInput = z.infer<typeof scimGroupInputSchema>;

// RFC 7644 §3.5.2 PatchOp. We honor replace/add of `active` and a handful
// of simple attributes; anything else is acknowledged but logged.
export const scimPatchOpSchema = z.object({
  schemas: z.array(z.string()),
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});
export type ScimPatchOp = z.infer<typeof scimPatchOpSchema>;

// ---------- outbound (us -> IdP) ----------
export const scimUserResourceSchema = z.object({
  schemas: z.array(z.string()),
  id: z.string(),
  externalId: z.string().optional(),
  userName: z.string(),
  name: z.object({ givenName: z.string(), familyName: z.string() }),
  displayName: z.string(),
  emails: z.array(z.object({ value: z.string(), primary: z.boolean() })),
  active: z.boolean(),
  meta: scimMetaSchema,
});
export type ScimUserResource = z.infer<typeof scimUserResourceSchema>;

export const scimGroupResourceSchema = z.object({
  schemas: z.array(z.string()),
  id: z.string(),
  externalId: z.string().optional(),
  displayName: z.string(),
  members: z.array(z.object({ value: z.string(), display: z.string().optional() })),
  meta: scimMetaSchema,
});
export type ScimGroupResource = z.infer<typeof scimGroupResourceSchema>;

export const scimListResponseSchema = z.object({
  schemas: z.array(z.string()),
  totalResults: z.number().int(),
  startIndex: z.number().int(),
  itemsPerPage: z.number().int(),
  Resources: z.array(z.unknown()),
});
export type ScimListResponse = z.infer<typeof scimListResponseSchema>;

export const scimErrorSchema = z.object({
  schemas: z.array(z.string()),
  status: z.string(),
  scimType: z.string().optional(),
  detail: z.string().optional(),
});
export type ScimError = z.infer<typeof scimErrorSchema>;
