export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  DISPATCHER: 'dispatcher',
  DRIVER: 'driver',
  ACCOUNTING: 'accounting',
  AUDITOR: 'auditor',
} as const;

export const ROLE_VALUES = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.DISPATCHER,
  ROLES.DRIVER,
  ROLES.ACCOUNTING,
  ROLES.AUDITOR,
] as const;

export type Role = (typeof ROLE_VALUES)[number];

/**
 * Privilege ordering — higher index = more authority. Used by guards
 * for "at least manager" checks.
 */
export const ROLE_RANK: Record<Role, number> = {
  auditor: 0,
  driver: 1,
  accounting: 2,
  dispatcher: 3,
  manager: 4,
  admin: 5,
  owner: 6,
};

export const hasAtLeastRole = (actor: Role, minimum: Role): boolean =>
  ROLE_RANK[actor] >= ROLE_RANK[minimum];
