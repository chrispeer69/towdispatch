/**
 * ScimService — RFC 7643/7644 Users + Groups provisioning, scoped to the
 * tenant the bearer token resolved to (ScimAuthGuard). Every operation runs
 * in that tenant's RLS context, so cross-tenant writes are impossible by
 * construction.
 *
 * SCIM users ARE local users (users table). A re-POST of an existing
 * externalId / userName returns the existing user (idempotent). De-provision
 * (DELETE or PATCH active=false) soft-deletes the user AND revokes its
 * refresh sessions — reusing the same sessions table AuthService manages, so
 * the access token dies at TTL and refresh is dead immediately.
 */
import { Injectable } from '@nestjs/common';
import {
  type ScimGroup,
  type User,
  scimGroupMembers,
  scimGroups,
  sessions,
  users,
} from '@ustowdispatch/db/schema';
import {
  SCIM_GROUP_SCHEMA,
  SCIM_USER_SCHEMA,
  type ScimGroupInput,
  type ScimGroupResource,
  type ScimPatchOp,
  type ScimUserInput,
  type ScimUserResource,
} from '@ustowdispatch/shared';
import { and, count, eq, ilike, isNotNull, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ConfigService } from '../../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../../database/tenant-aware-db.service.js';
import { type ScimEqClause } from './scim-filter.js';

export interface ScimContext {
  tenantId: string;
  connectionId: string | null;
  requestId: string;
}

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
/** SCIM-provisioned users default to dispatcher unless a group/role maps. */
const SCIM_DEFAULT_ROLE = 'dispatcher' as const;

export class ScimNotFoundError extends Error {}
export class ScimConflictError extends Error {}

@Injectable()
export class ScimService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: TenantAwareDb,
  ) {}

  private ctxOf(scim: ScimContext): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: scim.tenantId, userId: SYSTEM_ACTOR, requestId: scim.requestId };
  }

  // =========================================================================
  // Users
  // =========================================================================
  async listUsers(
    scim: ScimContext,
    clauses: ScimEqClause[],
    page: { startIndex: number; count: number },
  ): Promise<{ total: number; resources: ScimUserResource[] }> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const userName = clauses.find((c) => c.attribute.toLowerCase() === 'username')?.value;
      const externalId = clauses.find((c) => c.attribute.toLowerCase() === 'externalid')?.value;

      const conds = [isNull(users.deletedAt)];
      if (typeof userName === 'string') conds.push(eq(users.email, userName.toLowerCase()));
      if (typeof externalId === 'string') conds.push(eq(users.externalId, externalId));

      const rows = await tx
        .select()
        .from(users)
        .where(and(...conds))
        .limit(Math.min(page.count, 200))
        .offset(Math.max(page.startIndex - 1, 0));
      // totalResults must be the count of ALL matches, not the page size —
      // IdPs paginate until startIndex+itemsPerPage >= totalResults.
      const [c] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(...conds));
      return { total: c?.n ?? rows.length, resources: rows.map((r) => this.toScimUser(r)) };
    });
  }

  async getUser(scim: ScimContext, id: string): Promise<ScimUserResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const row = await this.findUser(tx, id);
      if (!row) throw new ScimNotFoundError('User not found');
      return this.toScimUser(row);
    });
  }

  /** Create or (idempotently) return an existing user by externalId/userName. */
  async createUser(scim: ScimContext, input: ScimUserInput): Promise<ScimUserResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const email = this.resolveEmail(input);
      const externalId = input.externalId;

      // Idempotency: existing externalId or userName/email returns the row.
      const existing = await tx.query.users.findFirst({
        where: and(
          eq(users.tenantId, scim.tenantId),
          eq(users.email, email),
          isNull(users.deletedAt),
        ),
      });
      if (existing) {
        const [updated] = await tx
          .update(users)
          .set({
            ...(externalId ? { externalId } : {}),
            ssoConnectionId: scim.connectionId,
            isActive: input.active ?? existing.isActive,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning();
        return this.toScimUser(updated ?? existing);
      }

      const { firstName, lastName } = this.resolveName(input, email);
      const id = uuidv7();
      // SCIM-provisioned users authenticate via the IdP, never a password.
      const passwordHash = `scim:${uuidv7()}`;
      const [row] = await tx
        .insert(users)
        .values({
          id,
          tenantId: scim.tenantId,
          email,
          emailVerifiedAt: new Date(),
          passwordHash,
          firstName,
          lastName,
          role: SCIM_DEFAULT_ROLE,
          isActive: input.active ?? true,
          externalId: externalId ?? null,
          ssoConnectionId: scim.connectionId,
        })
        .returning();
      if (!row) throw new Error('scim createUser: insert returning() yielded no row');
      return this.toScimUser(row);
    });
  }

  /** PUT — full replace of the mutable SCIM attributes. */
  async replaceUser(
    scim: ScimContext,
    id: string,
    input: ScimUserInput,
  ): Promise<ScimUserResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const row = await this.findUser(tx, id);
      if (!row) throw new ScimNotFoundError('User not found');
      const { firstName, lastName } = this.resolveName(input, row.email);
      const active = input.active ?? true;
      const [updated] = await tx
        .update(users)
        .set({
          firstName,
          lastName,
          isActive: active,
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(active ? {} : { deletedAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      if (!active) await this.revokeSessions(tx, id);
      return this.toScimUser(updated ?? row);
    });
  }

  /** PATCH — we honor replace/add of `active` (the deactivation path). */
  async patchUser(scim: ScimContext, id: string, patch: ScimPatchOp): Promise<ScimUserResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const row = await this.findUser(tx, id);
      if (!row) throw new ScimNotFoundError('User not found');

      let active: boolean | undefined;
      for (const op of patch.Operations) {
        const opName = op.op.toLowerCase();
        if (opName !== 'replace' && opName !== 'add') continue;
        // { op:'replace', path:'active', value:false } OR
        // { op:'replace', value:{ active:false } }
        if (op.path && op.path.toLowerCase() === 'active') {
          active = this.asBool(op.value);
        } else if (!op.path && op.value && typeof op.value === 'object') {
          const v = (op.value as Record<string, unknown>).active;
          if (v !== undefined) active = this.asBool(v);
        }
      }

      if (active === undefined) return this.toScimUser(row);
      const [updated] = await tx
        .update(users)
        .set({
          isActive: active,
          ...(active ? { deletedAt: null } : { deletedAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      if (!active) await this.revokeSessions(tx, id);
      return this.toScimUser(updated ?? row);
    });
  }

  /** DELETE — de-provision: soft-delete + revoke sessions. */
  async deleteUser(scim: ScimContext, id: string): Promise<void> {
    await this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const row = await this.findUser(tx, id);
      if (!row) throw new ScimNotFoundError('User not found');
      await tx
        .update(users)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id));
      await this.revokeSessions(tx, id);
    });
  }

  // =========================================================================
  // Groups
  // =========================================================================
  async listGroups(
    scim: ScimContext,
    clauses: ScimEqClause[],
    page: { startIndex: number; count: number },
  ): Promise<{ total: number; resources: ScimGroupResource[] }> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const displayName = clauses.find((c) => c.attribute.toLowerCase() === 'displayname')?.value;
      const conds = [isNull(scimGroups.deletedAt)];
      if (typeof displayName === 'string') conds.push(ilike(scimGroups.displayName, displayName));
      const rows = await tx
        .select()
        .from(scimGroups)
        .where(and(...conds))
        .limit(Math.min(page.count, 200))
        .offset(Math.max(page.startIndex - 1, 0));
      const resources = await Promise.all(rows.map((r) => this.toScimGroup(tx, r)));
      const [cnt] = await tx
        .select({ n: count() })
        .from(scimGroups)
        .where(and(...conds));
      return { total: cnt?.n ?? rows.length, resources };
    });
  }

  async getGroup(scim: ScimContext, id: string): Promise<ScimGroupResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const row = await tx.query.scimGroups.findFirst({
        where: and(eq(scimGroups.id, id), isNull(scimGroups.deletedAt)),
      });
      if (!row) throw new ScimNotFoundError('Group not found');
      return this.toScimGroup(tx, row);
    });
  }

  async createGroup(scim: ScimContext, input: ScimGroupInput): Promise<ScimGroupResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      // Idempotency by externalId.
      if (input.externalId) {
        const existing = await tx.query.scimGroups.findFirst({
          where: and(
            eq(scimGroups.tenantId, scim.tenantId),
            eq(scimGroups.externalId, input.externalId),
            isNull(scimGroups.deletedAt),
          ),
        });
        if (existing) return this.toScimGroup(tx, existing);
      }
      const id = uuidv7();
      const [row] = await tx
        .insert(scimGroups)
        .values({
          id,
          tenantId: scim.tenantId,
          connectionId: scim.connectionId,
          externalId: input.externalId ?? null,
          displayName: input.displayName,
        })
        .returning();
      if (!row) throw new Error('scim createGroup: insert returning() yielded no row');
      await this.replaceMembers(tx, scim.tenantId, row.id, input.members ?? []);
      return this.toScimGroup(tx, row);
    });
  }

  async replaceGroup(
    scim: ScimContext,
    id: string,
    input: ScimGroupInput,
  ): Promise<ScimGroupResource> {
    return this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const [row] = await tx
        .update(scimGroups)
        .set({
          displayName: input.displayName,
          ...(input.externalId ? { externalId: input.externalId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(scimGroups.id, id), isNull(scimGroups.deletedAt)))
        .returning();
      if (!row) throw new ScimNotFoundError('Group not found');
      await this.replaceMembers(tx, scim.tenantId, id, input.members ?? []);
      return this.toScimGroup(tx, row);
    });
  }

  async deleteGroup(scim: ScimContext, id: string): Promise<void> {
    await this.db.runInTenantContext(this.ctxOf(scim), async (tx) => {
      const [row] = await tx
        .update(scimGroups)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(scimGroups.id, id), isNull(scimGroups.deletedAt)))
        .returning();
      if (!row) throw new ScimNotFoundError('Group not found');
      await tx.delete(scimGroupMembers).where(eq(scimGroupMembers.groupId, id));
    });
  }

  // =========================================================================
  // helpers
  // =========================================================================
  private async findUser(tx: Tx, id: string): Promise<User | undefined> {
    return tx.query.users.findFirst({
      where: and(eq(users.id, id), isNotNull(users.externalId)),
    });
  }

  private async revokeSessions(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  private async replaceMembers(
    tx: Tx,
    tenantId: string,
    groupId: string,
    members: Array<{ value: string }>,
  ): Promise<void> {
    await tx.delete(scimGroupMembers).where(eq(scimGroupMembers.groupId, groupId));
    for (const m of members) {
      // Only link members that resolve to a live user in this tenant.
      const u = await tx.query.users.findFirst({
        where: and(eq(users.id, m.value), isNull(users.deletedAt)),
        columns: { id: true },
      });
      if (!u) continue;
      await tx
        .insert(scimGroupMembers)
        .values({ id: uuidv7(), tenantId, groupId, userId: u.id })
        .onConflictDoNothing();
    }
  }

  private resolveEmail(input: ScimUserInput): string {
    const primary = input.emails?.find((e) => e.primary)?.value;
    const first = input.emails?.[0]?.value;
    const email = (primary ?? first ?? input.userName).trim().toLowerCase();
    return email;
  }

  private resolveName(
    input: ScimUserInput,
    email: string,
  ): { firstName: string; lastName: string } {
    const firstName = input.name?.givenName?.trim() || email.split('@')[0] || 'SCIM';
    const lastName = input.name?.familyName?.trim() || 'User';
    return { firstName, lastName };
  }

  private asBool(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    return false;
  }

  private toScimUser(row: User): ScimUserResource {
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: row.id,
      ...(row.externalId ? { externalId: row.externalId } : {}),
      userName: row.email,
      name: { givenName: row.firstName, familyName: row.lastName },
      displayName: `${row.firstName} ${row.lastName}`.trim(),
      emails: [{ value: row.email, primary: true }],
      active: row.isActive && !row.deletedAt,
      meta: {
        resourceType: 'User',
        created: row.createdAt.toISOString(),
        lastModified: row.updatedAt.toISOString(),
        location: `${this.config.apiPublicUrl}/scim/v2/Users/${row.id}`,
      },
    };
  }

  private async toScimGroup(tx: Tx, row: ScimGroup): Promise<ScimGroupResource> {
    const memberRows = await tx
      .select({ userId: scimGroupMembers.userId })
      .from(scimGroupMembers)
      .where(eq(scimGroupMembers.groupId, row.id));
    return {
      schemas: [SCIM_GROUP_SCHEMA],
      id: row.id,
      ...(row.externalId ? { externalId: row.externalId } : {}),
      displayName: row.displayName,
      members: memberRows.map((m) => ({ value: m.userId })),
      meta: {
        resourceType: 'Group',
        created: row.createdAt.toISOString(),
        lastModified: row.updatedAt.toISOString(),
        location: `${this.config.apiPublicUrl}/scim/v2/Groups/${row.id}`,
      },
    };
  }
}
