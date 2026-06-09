/**
 * StorageModule — provides the StorageProvider implementation.
 *
 * Default: LocalDiskStorageProvider rooted at apps/api/storage. Production
 * will swap in S3StorageProvider via env-driven factory; the swap is one
 * useFactory change because every consumer programs against the
 * StorageProvider interface from @towdispatch/shared.
 */
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import type { StorageProvider } from '@towdispatch/shared';
import { LocalDiskStorageProvider } from './local-disk.storage.js';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

const storageRoot = (): string => process.env.STORAGE_LOCAL_ROOT ?? join(process.cwd(), 'storage');

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: (): StorageProvider => new LocalDiskStorageProvider(storageRoot()),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
