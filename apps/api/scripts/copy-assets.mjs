/**
 * Copies non-TS assets into dist/.
 *
 * tsc emits api source under `dist/apps/api/src/...` because the workspace
 * imports cross-package, so output mirrors the highest common ancestor. Each
 * runtime asset is read relative to its companion .js, so they all need to
 * land in the matching dist path.
 *
 * Assets copied:
 *   - src/modules/email/templates → dist .../email/templates
 *   - src/modules/import/column-mappings → dist .../import/column-mappings
 *     (used by ImportRunService.loadMapping at run time)
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_API = join(ROOT, 'dist', 'apps', 'api', 'src');

const ASSETS = [
  { src: join(ROOT, 'src', 'modules', 'email', 'templates'), dst: join(DIST_API, 'modules', 'email', 'templates') },
  { src: join(ROOT, 'src', 'modules', 'import', 'column-mappings'), dst: join(DIST_API, 'modules', 'import', 'column-mappings') },
];

for (const { src, dst } of ASSETS) {
  if (!existsSync(src)) {
    process.stderr.write(`[copy-assets] source not found, skipping: ${src}\n`);
    continue;
  }
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  process.stdout.write(`[copy-assets] copied ${src} → ${dst}\n`);
}
