import { z } from 'zod';
import { ROLE_VALUES } from '../constants/roles';

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Must contain an uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Must contain a digit');

export const emailSchema = z.string().email().max(254).toLowerCase();

export const userSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: emailSchema,
  emailVerifiedAt: z.string().datetime().nullable(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  phone: z.string().max(40).nullable(),
  role: z.enum(ROLE_VALUES),
  isActive: z.boolean(),
  mfaEnabled: z.boolean().optional(),
  yardIds: z.array(z.string().uuid()).nullable().optional(),
  /**
   * Build 5 RED ALERT cron — Monday 06:00 past-due email digest.
   * Owners and admins receive by virtue of role; other roles must
   * opt in. Backed by the users.receives_red_alert column added in
   * migration 0029.
   */
  receivesRedAlert: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type UserDto = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  phone: z.string().max(40).optional(),
  role: z.enum(ROLE_VALUES).default('dispatcher'),
  yardIds: z.array(z.string().uuid()).max(50).optional(),
});

export type CreateUserPayload = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  isActive: z.boolean().optional(),
  receivesRedAlert: z.boolean().optional(),
});
export type UpdateUserPayload = z.infer<typeof updateUserSchema>;
