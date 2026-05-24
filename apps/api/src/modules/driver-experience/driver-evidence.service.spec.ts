/**
 * Unit tests for DriverEvidenceService.delete and the thumbnail-URL
 * enrichment in listForJob. The DB is mocked: runInTenantContext just
 * invokes the callback with a hand-rolled Drizzle tx stub, so these run
 * without a live Postgres. RLS / audit behavior is covered by the
 * DB-gated integration spec.
 */
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverEvidenceService } from './driver-evidence.service.js';
import {
  type EvidenceStorageProvider,
  isThumbnailableKind,
} from './evidence-storage/evidence-storage.provider.js';

const TENANT = '00000000-0000-7000-8000-0000000000aa';
const JOB = '00000000-0000-7000-8000-0000000000bb';

const actor = {
  tenantId: TENANT,
  actorId: '00000000-0000-7000-8000-0000000000cc',
  driverId: null,
  requestId: 'req-1',
  ipAddress: null,
  userAgent: null,
};

interface RowOverrides {
  id?: string;
  kind?: string;
  uploadStatus?: string;
  s3Key?: string;
}

function makeRow(o: RowOverrides = {}) {
  const now = new Date('2026-05-23T12:00:00Z');
  return {
    id: o.id ?? '00000000-0000-7000-8000-0000000000d1',
    tenantId: TENANT,
    jobId: JOB,
    driverId: null,
    shiftId: null,
    kind: o.kind ?? 'photo_pickup',
    s3Key: o.s3Key ?? `tenants/${TENANT}/job-evidence/${JOB}/evid-${o.kind ?? 'photo_pickup'}.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 1000,
    widthPx: null,
    heightPx: null,
    durationSeconds: null,
    capturedAt: null,
    uploadStatus: o.uploadStatus ?? 'uploaded',
    uploadedAt: now,
    failureReason: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function makeStorage(): EvidenceStorageProvider {
  return {
    id: 'fake',
    presignPut: vi.fn(),
    presignGet: vi.fn(async () => ({ url: 'get://asset', expiresAt: 111 })),
    presignGetThumbnail: vi.fn(async ({ kind }) =>
      isThumbnailableKind(kind) ? { url: `thumb://${kind}`, expiresAt: 222 } : null,
    ),
    generateThumbnail: vi.fn(async () => true),
  } as unknown as EvidenceStorageProvider;
}

/**
 * Minimal Drizzle tx stub. `findFirstResult` drives the existence checks;
 * `selectRows` drives listForJob's row scan. The update chain records
 * the `.set(...)` payload so the soft-delete assertion can read it back.
 */
function makeDb(opts: {
  findFirstResult?: unknown;
  jobsFindFirst?: unknown;
  selectRows?: unknown[];
  returningRow?: unknown;
  setSpy?: ReturnType<typeof vi.fn>;
}) {
  const setSpy = opts.setSpy ?? vi.fn();
  const tx = {
    query: {
      jobEvidence: { findFirst: vi.fn(async () => opts.findFirstResult ?? null) },
      jobs: { findFirst: vi.fn(async () => opts.jobsFindFirst ?? null) },
    },
    update: vi.fn(() => ({
      set: vi.fn((payload: unknown) => {
        setSpy(payload);
        // `.where()` is awaited directly by delete (result ignored) and
        // chained with `.returning()` by finalize — support both.
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => (opts.returningRow ? [opts.returningRow] : [])),
          })),
        };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(async () => opts.selectRows ?? []) })),
      })),
    })),
  };
  const db = {
    runInTenantContext: vi.fn(async (_ctx: unknown, cb: (tx: unknown) => unknown) => cb(tx)),
  };
  return { db, setSpy };
}

describe('DriverEvidenceService.delete', () => {
  let storage: EvidenceStorageProvider;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('soft-deletes by stamping deletedAt when the row exists', async () => {
    const { db, setSpy } = makeDb({ findFirstResult: { id: makeRow().id } });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    await svc.delete(actor, makeRow().id);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const payload = setSpy.mock.calls[0]?.[0] as { deletedAt: Date };
    expect(payload.deletedAt).toBeInstanceOf(Date);
  });

  it('throws NotFound when the row is absent (or invisible under RLS)', async () => {
    const { db } = makeDb({ findFirstResult: null });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    await expect(svc.delete(actor, makeRow().id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DriverEvidenceService.finalize', () => {
  let storage: EvidenceStorageProvider;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('flips the row to uploaded and fires best-effort thumbnail generation', async () => {
    const row = makeRow({ kind: 'photo_pickup' });
    const { db } = makeDb({ findFirstResult: row, returningRow: row });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    const dto = await svc.finalize(actor, row.id, {});
    expect(dto.uploadStatus).toBe('uploaded');
    expect(storage.generateThumbnail).toHaveBeenCalledTimes(1);
    const arg = (storage.generateThumbnail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      kind: string;
      key: string;
    };
    expect(arg.kind).toBe('photo_pickup');
    expect(arg.key).toBe(row.s3Key);
  });

  it('does not fail finalize when thumbnail generation throws', async () => {
    storage.generateThumbnail = vi.fn(async () => {
      throw new Error('boom');
    });
    const row = makeRow();
    const { db } = makeDb({ findFirstResult: row, returningRow: row });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    await expect(svc.finalize(actor, row.id, {})).resolves.toMatchObject({
      uploadStatus: 'uploaded',
    });
  });

  it('404s when the evidence row is absent and never generates a thumbnail', async () => {
    const { db } = makeDb({ findFirstResult: null });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    await expect(svc.finalize(actor, makeRow().id, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.generateThumbnail).not.toHaveBeenCalled();
  });
});

describe('DriverEvidenceService.listForJob', () => {
  let storage: EvidenceStorageProvider;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('attaches download + thumbnail URLs for an uploaded photo', async () => {
    const { db } = makeDb({
      jobsFindFirst: { id: JOB },
      selectRows: [makeRow({ kind: 'photo_pickup' })],
    });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    const [row] = await svc.listForJob(actor, JOB);
    expect(row?.downloadUrl).toBe('get://asset');
    expect(row?.thumbnailUrl).toBe('thumb://photo_pickup');
    expect(row?.thumbnailUrlExpiresAt).toBe(222);
  });

  it('leaves thumbnailUrl null for a document but still signs the download', async () => {
    const { db } = makeDb({
      jobsFindFirst: { id: JOB },
      selectRows: [
        makeRow({ kind: 'document_scan', s3Key: `tenants/${TENANT}/job-evidence/${JOB}/d.pdf` }),
      ],
    });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    const [row] = await svc.listForJob(actor, JOB);
    expect(row?.downloadUrl).toBe('get://asset');
    expect(row?.thumbnailUrl).toBeNull();
  });

  it('returns null URLs for a pending row and never signs it', async () => {
    const { db } = makeDb({
      jobsFindFirst: { id: JOB },
      selectRows: [makeRow({ uploadStatus: 'pending' })],
    });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    const [row] = await svc.listForJob(actor, JOB);
    expect(row?.downloadUrl).toBeNull();
    expect(row?.thumbnailUrl).toBeNull();
    expect(storage.presignGet).not.toHaveBeenCalled();
    expect(storage.presignGetThumbnail).not.toHaveBeenCalled();
  });

  it('404s when the job does not exist', async () => {
    const { db } = makeDb({ jobsFindFirst: null });
    // biome-ignore lint/suspicious/noExplicitAny: test wiring
    const svc = new DriverEvidenceService(db as any, storage);
    await expect(svc.listForJob(actor, JOB)).rejects.toBeInstanceOf(NotFoundException);
  });
});
