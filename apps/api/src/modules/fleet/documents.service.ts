/**
 * DocumentsService — polymorphic file metadata + content storage delegate.
 *
 * Storage bytes flow through the StorageProvider (see ./storage). The
 * documents row is the searchable record of metadata: owner, type, expiry,
 * uploader. Soft-delete here doesn't immediately purge bytes — purge is a
 * background job in a future session, so audit/compliance reviews can still
 * pull the file.
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { documents, jobs, uuidv7 } from '@towcommand/db';
import {
  type DocumentDto,
  type DocumentFilters,
  type DocumentOwnerType,
  type DocumentType,
  ERROR_CODES,
  type Role,
  type StorageProvider,
} from '@towcommand/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { StorageAccessDenied } from '../storage/local-disk.storage.js';
import { STORAGE_PROVIDER } from '../storage/storage.module.js';
import { isDriverRole, resolveDriverIdForUser, resolveTruckIdsForDriver } from './driver-scope.js';

export interface UploadDocumentInput {
  ownerType: DocumentOwnerType;
  ownerId: string;
  docType: DocumentType;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  expiresAt?: string | null;
  notes?: string | null;
}

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Records visible to a driver: their own driver-doc + any current truck. */
interface DriverDocScope {
  driverId: string;
  truckIds: string[];
}

async function loadDriverScope(tx: Tx, userId: string): Promise<DriverDocScope> {
  const driverId = await resolveDriverIdForUser(tx, userId);
  const truckIds = await resolveTruckIdsForDriver(tx, driverId);
  return { driverId, truckIds };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: TenantAwareDb,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async list(ctx: CallerContext, filters: DocumentFilters): Promise<DocumentDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(documents.deletedAt)];
      if (filters.ownerType) conds.push(eq(documents.ownerType, filters.ownerType));
      if (filters.ownerId) conds.push(eq(documents.ownerId, filters.ownerId));
      if (filters.docType) conds.push(eq(documents.docType, filters.docType));

      // Drivers only see their own driver-docs + their current truck's docs.
      // We OR these two onto the WHERE; if the driver has no truck assignment
      // the truck clause collapses to a guaranteed-empty inArray.
      if (isDriverRole(ctx.role)) {
        const scope = await loadDriverScope(tx, ctx.userId);
        const driverClause = and(
          eq(documents.ownerType, 'driver'),
          eq(documents.ownerId, scope.driverId),
        );
        const truckClause =
          scope.truckIds.length > 0
            ? and(eq(documents.ownerType, 'truck'), inArray(documents.ownerId, scope.truckIds))
            : undefined;
        const scopeExpr = truckClause ? or(driverClause, truckClause) : driverClause;
        if (scopeExpr) conds.push(scopeExpr);
      }

      const rows = await tx.query.documents.findMany({
        where: and(...conds),
        orderBy: (t, { desc }) => [desc(t.uploadedAt)],
      });
      return rows.map(toDto);
    });
  }

  async get(ctx: CallerContext, id: string): Promise<DocumentDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.documents.findFirst({
        where: and(eq(documents.id, id), isNull(documents.deletedAt)),
      });
      if (!row) throw notFound();
      if (isDriverRole(ctx.role)) {
        const scope = await loadDriverScope(tx, ctx.userId);
        const ok = await isVisibleToDriverAsync(tx, row.ownerType, row.ownerId, scope);
        if (!ok) throw notFound();
      }
      return toDto(row);
    });
  }

  async upload(ctx: CallerContext, input: UploadDocumentInput): Promise<DocumentDto> {
    // Drivers can only upload onto their own driver record, their currently
    // assigned trucks, or a job that's currently assigned to them. We resolve
    // the scope up-front (cheap, one query per request) so the storage write
    // doesn't happen for forbidden owners and leave an orphan blob behind.
    if (isDriverRole(ctx.role)) {
      await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const scope = await loadDriverScope(tx, ctx.userId);
        const ok = await isVisibleToDriverAsync(tx, input.ownerType, input.ownerId, scope);
        if (!ok) {
          throw new ForbiddenException({
            code: ERROR_CODES.FORBIDDEN,
            message:
              'Drivers may only upload documents for themselves, their assigned truck, or a job assigned to them',
          });
        }
      });
    }

    const stored = await this.storage.put({
      tenantId: ctx.tenantId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });

    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const id = uuidv7();
      const [row] = await tx
        .insert(documents)
        .values({
          id,
          tenantId: ctx.tenantId,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          docType: input.docType,
          fileUrl: stored.key,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: stored.sizeBytes,
          uploadedBy: ctx.userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new Error('insert documents returned no row');
      return toDto(row);
    });
  }

  /**
   * Read bytes for a document. Looks the row up under tenant context so RLS
   * blocks cross-tenant reads at the row layer; the StorageProvider then
   * verifies the key belongs to the tenant for defense in depth (catches
   * any future bug that lets a row of tenant A point at storage of tenant B).
   */
  async readBytes(ctx: CallerContext, id: string): Promise<{ bytes: Buffer; doc: DocumentDto }> {
    const doc = await this.get(ctx, id);
    try {
      const bytes = await this.storage.get(ctx.tenantId, doc.fileUrl);
      return { bytes, doc };
    } catch (err) {
      if (err instanceof StorageAccessDenied) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Storage access denied',
        });
      }
      throw err;
    }
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(documents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
        .returning({ id: documents.id });
      return Boolean(row);
    });
    if (!ok) throw notFound();
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

const notFound = (): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Document not found' });

/**
 * Does the given (ownerType, ownerId) belong to the driver's visible set?
 * - driver: their own driver record
 * - truck:  any of their current truck assignments
 * - job:    a job currently assigned to them (looked up live, since job
 *           assignments rotate faster than truck assignments and we don't
 *           pre-cache them on the scope object)
 * Other owner types (customer, account, vehicle) are not driver-visible.
 */
async function isVisibleToDriverAsync(
  tx: Tx,
  ownerType: DocumentOwnerType,
  ownerId: string,
  scope: DriverDocScope,
): Promise<boolean> {
  if (ownerType === 'driver') return ownerId === scope.driverId;
  if (ownerType === 'truck') return scope.truckIds.includes(ownerId);
  if (ownerType === 'job') {
    const j = await tx.query.jobs.findFirst({
      where: and(eq(jobs.id, ownerId), isNull(jobs.deletedAt)),
      columns: { assignedDriverId: true },
    });
    return j?.assignedDriverId === scope.driverId;
  }
  return false;
}

function toDto(d: typeof documents.$inferSelect): DocumentDto {
  return {
    id: d.id,
    tenantId: d.tenantId,
    ownerType: d.ownerType,
    ownerId: d.ownerId,
    docType: d.docType,
    fileUrl: d.fileUrl,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt.toISOString(),
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    notes: d.notes,
  };
}
