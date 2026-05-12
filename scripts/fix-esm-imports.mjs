#!/usr/bin/env node
/**
 * Rewrites bare relative imports in compiled .js to use explicit .js extensions,
 * which Node ESM requires at runtime. tsc with module=ESNext + moduleResolution=Bundler
 * does not rewrite extensions, so we post-process the dist tree.
 *
 * Usage: node scripts/fix-esm-imports.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.argv[2];
if (!root) {
  process.stderr.write('usage: fix-esm-imports.mjs <dist-dir>\n');
  process.exit(2);
}
const ROOT = resolve(root);

// Matches: import ... from './x' | import './x' | export ... from './x' | export * from './x'
// Also dynamic import('./x'). Capturing group preserves the path so we can re-emit it with .js.
const SPECIFIER_RE =
  /(\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?|import\s*\(\s*|\bexport\s*\*\s*from\s+)(['"])(\.\.?\/[^'"\n]+?)\2/g;

function rewrite(content) {
  return content.replace(SPECIFIER_RE, (_m, head, q, spec) => {
    // Already has a known extension — leave it alone.
    if (/\.(m?js|json|node)$/.test(spec)) return `${head}${q}${spec}${q}`;
    return `${head}${q}${spec}.js${q}`;
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!full.endsWith('.js')) continue;
    const before = readFileSync(full, 'utf8');
    const after = rewrite(before);
    if (after !== before) writeFileSync(full, after);
  }
}

walk(ROOT);
process.stdout.write(`[fix-esm-imports] rewrote relative imports in ${ROOT}\n`);
