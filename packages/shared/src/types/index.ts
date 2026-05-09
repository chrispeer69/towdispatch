/**
 * Shared TypeScript types not directly inferable from a Zod schema.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type RequestId = Brand<string, 'RequestId'>;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  requestId?: string;
  errors?: Array<{ path: string; message: string }>;
}

export interface RequestContext {
  requestId: RequestId;
  tenantId: TenantId | null;
  userId: UserId | null;
  role: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}
