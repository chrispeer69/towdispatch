import { z } from 'zod';
import { TENANT_STATUS_VALUES } from '../constants/tenant-status';

export const tenantSlugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'lowercase letters, numbers, and hyphens; cannot start or end with a hyphen',
  });

export const tenantSchema = z.object({
  id: z.string().uuid(),
  slug: tenantSlugSchema,
  name: z.string().min(1).max(120),
  status: z.enum(TENANT_STATUS_VALUES),
  settings: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type TenantDto = z.infer<typeof tenantSchema>;

export const createTenantSchema = z.object({
  slug: tenantSlugSchema,
  name: z.string().min(1).max(120),
});

export type CreateTenantPayload = z.infer<typeof createTenantSchema>;
