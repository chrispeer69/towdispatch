import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

/**
 * Used by `vite-node` to run the API in dev. The same SWC transform that
 * vitest uses, so decorator metadata works the same way at boot as in tests.
 *
 * `vite-node src/main.ts` is the dev entrypoint. tsx is intentionally not used
 * here because esbuild — tsx's transformer — does not emit decorator metadata,
 * which NestJS's DI graph silently breaks on.
 */
export default defineConfig({
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
      '@towdispatch/shared': new URL('../../packages/shared/src/index.ts', import.meta.url)
        .pathname,
      '@towdispatch/db/schema': new URL('../../packages/db/src/schema/index.ts', import.meta.url)
        .pathname,
      '@towdispatch/db': new URL('../../packages/db/src/index.ts', import.meta.url).pathname,
    },
  },
});
