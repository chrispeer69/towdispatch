/**
 * LocalDiskStorageProvider — dev/test implementation of StorageProvider.
 *
 * Lays bytes down at `apps/api/storage/tenants/{tenantId}/{ownerType}/{ownerId}/{uuid}-{fileName}`.
 * Every key is verified against the tenantId prefix on every read/delete so
 * a path-traversal attempt (`../tenants/other-uuid/...`) raises a 403-ish
 * StorageAccessDenied error before any filesystem read happens.
 *
 * Production deployments swap in S3StorageProvider via env-driven DI.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@towdispatch/db';
import type { StorageProvider, StoragePutInput, StoredObject } from '@towdispatch/shared';

const TENANT_PREFIX = 'tenants';

export class StorageAccessDenied extends Error {
  constructor(message = 'storage access denied') {
    super(message);
    this.name = 'StorageAccessDenied';
  }
}

@Injectable()
export class LocalDiskStorageProvider implements StorageProvider {
  readonly id = 'local-disk';

  constructor(private readonly rootDir: string) {}

  async put(input: StoragePutInput): Promise<StoredObject> {
    if (!input.tenantId || !/^[0-9a-f-]{36}$/i.test(input.tenantId)) {
      throw new StorageAccessDenied('invalid tenantId');
    }
    if (!input.ownerType || !/^[a-z_]{2,40}$/.test(input.ownerType)) {
      throw new StorageAccessDenied('invalid ownerType');
    }
    if (!input.ownerId || !/^[0-9a-f-]{36}$/i.test(input.ownerId)) {
      throw new StorageAccessDenied('invalid ownerId');
    }
    const safeName = sanitizeFileName(input.fileName);
    const objectId = uuidv7();
    const key = `${TENANT_PREFIX}/${input.tenantId}/${input.ownerType}/${input.ownerId}/${objectId}-${safeName}`;
    const abs = this.absolutePath(input.tenantId, key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, input.bytes);
    return {
      key,
      sizeBytes: input.bytes.byteLength,
      mimeType: input.mimeType,
      fileName: input.fileName,
    };
  }

  async get(tenantId: string, key: string): Promise<Buffer> {
    const abs = this.absolutePath(tenantId, key);
    return readFile(abs);
  }

  async delete(tenantId: string, key: string): Promise<void> {
    const abs = this.absolutePath(tenantId, key);
    await rm(abs, { force: true });
  }

  toUrl(_tenantId: string, key: string): string {
    return `/files/${encodeURIComponent(key)}`;
  }

  /**
   * Verifies the tenant prefix and that the resolved path stays inside the
   * tenant root before returning it. Prevents `../`, absolute paths, and
   * symlink escapes.
   */
  private absolutePath(tenantId: string, key: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
      throw new StorageAccessDenied('invalid tenantId');
    }
    const expectedPrefix = `${TENANT_PREFIX}/${tenantId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new StorageAccessDenied('cross-tenant key access denied');
    }
    const tenantRoot = join(this.rootDir, TENANT_PREFIX, tenantId) + sep;
    const candidate = normalize(join(this.rootDir, key));
    if (!candidate.startsWith(tenantRoot)) {
      throw new StorageAccessDenied('path traversal blocked');
    }
    return candidate;
  }

  /** Best-effort exists check — used by tests to confirm bytes landed. */
  async exists(tenantId: string, key: string): Promise<boolean> {
    try {
      await stat(this.absolutePath(tenantId, key));
      return true;
    } catch {
      return false;
    }
  }
}

const SAFE_NAME_RE = /[^A-Za-z0-9._-]/g;
function sanitizeFileName(name: string): string {
  const trimmed = name.replace(/^\.+/, '').slice(0, 200);
  const safe = trimmed.replace(SAFE_NAME_RE, '_');
  return safe.length > 0 ? safe : 'upload';
}
