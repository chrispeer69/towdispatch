import { SetMetadata } from '@nestjs/common';
import type { Role } from '@towdispatch/shared';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to actors holding one of the listed roles. Combine with
 * RolesGuard. For "at least manager" semantics, callers list every role at
 * or above manager — explicit beats implicit here.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
