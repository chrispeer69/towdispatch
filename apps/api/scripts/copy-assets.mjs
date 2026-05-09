/**
 * Copies non-TS assets (email templates) into dist/.
 *
 * tsc emits api source under `dist/apps/api/src/...` because the workspace
 * imports cross-package, so output mirrors the highest common ancestor.
 * Templates are read by EmailService relative to its own .js, so they need to
 * land at `dist/apps/api/src/modules/email/templates/`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src', 'modules', 'email', 'templates');
const DST = join(__dirname, '..', 'dist', 'apps', 'api', 'src', 'modules', 'email', 'templates');

if (!existsSync(SRC)) {
  process.stderr.write(`[copy-assets] templates dir not found: ${SRC}\n`);
  process.exit(0);
}

mkdirSync(DST, { recursive: true });
cpSync(SRC, DST, { recursive: true });
process.stdout.write(`[copy-assets] copied templates → ${DST}\n`);
