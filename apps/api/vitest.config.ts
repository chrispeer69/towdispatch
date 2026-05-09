import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * SWC is the runtime here (not tsx) because tsx-via-esbuild does not emit
 * decorator metadata, and NestJS's DI relies on `Reflect.getMetadata` to
 * resolve constructor dependencies. unplugin-swc transforms TS with the same
 * `emitDecoratorMetadata` option set in tsconfig.json.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // tinypool's `threads` pool segfaults on Windows under the SWC plugin's
    // worker traffic (NestFactory bootstrap inside a worker thread is heavy).
    // `forks` is stable and gives us deterministic per-suite isolation.
    pool: 'forks',
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
    }),
  ],
  resolve: {
    alias: {
      '@towcommand/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
      '@towcommand/db/schema': new URL('../../packages/db/src/schema/index.ts', import.meta.url)
        .pathname,
      '@towcommand/db': new URL('../../packages/db/src/index.ts', import.meta.url).pathname,
    },
  },
});
