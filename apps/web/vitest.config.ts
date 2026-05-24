import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig.json's path map. Workspace packages publish a built
      // `dist/` entry that isn't present in dev worktrees, so point value
      // imports (e.g. zod schemas) at the TypeScript source. Listed before the
      // "@" alias so the longer, more specific keys win.
      '@ustowdispatch/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@ustowdispatch/ui': fileURLToPath(
        new URL('../../packages/ui/src/index.ts', import.meta.url),
      ),
      '@ustowdispatch/db': fileURLToPath(
        new URL('../../packages/db/src/index.ts', import.meta.url),
      ),
      // tsconfig.json's "@/*" -> "./src/*".
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Component specs (*.tsx) carry JSX. esbuild's automatic runtime emits
  // react/jsx-runtime calls so we don't need a per-file React import or the
  // HMR-focused @vitejs/plugin-react (avoids a new dependency).
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    globals: true,
    // jsdom (not node): the driver offline-queue + component specs read
    // window/localStorage. The pure-logic specs run unchanged under jsdom.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
    // Real unit tests exist now — drop passWithNoTests so an empty run is a
    // failure, not a silent green.
  },
});
