export const TENANT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
} as const;

export const TENANT_STATUS_VALUES = [
  TENANT_STATUS.ACTIVE,
  TENANT_STATUS.SUSPENDED,
  TENANT_STATUS.CANCELLED,
] as const;

export type TenantStatus = (typeof TENANT_STATUS_VALUES)[number];
