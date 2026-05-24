/**
 * PCI DSS evidence — Stripe-only, no raw cardholder data on our systems
 * (Req 3: don't store PAN/CVV; SAQ A-EP boundary assertion).
 *
 * Asserts the cardholder data environment (CDE) boundary holds in code: no raw
 * card field is declared as a database column or as a form input we render. We
 * use Stripe Elements/Checkout — the PAN is entered into a Stripe-hosted iframe
 * and we only ever see opaque tokens (payment_method, setup_intent, etc.). A raw
 * card column or `<input name="card_number">` would silently pull us into SAQ D
 * scope, so it is a HARD FAIL.
 *
 * Stripe's own token/element identifiers (payment_method, card token, CardElement)
 * are explicitly allowed — they are the compliant path.
 *
 * The detector (findRawCardFields) is pure; run() scans the DB schema and the web
 * source.
 *
 * Usage:
 *   tsx scripts/compliance/verify-stripe-only.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type CollectorResult, exitCodeFor, fileURLToPath, isMain, printResult } from './_util';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Forbidden raw cardholder-data identifiers. Word-boundaried so they only match
 * real field/column tokens, not substrings ("company", "expand", "panel").
 * Stripe-token identifiers are NOT in this list — they are the allowed path.
 */
const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /card[_-]?number/i, label: 'card_number' },
  { pattern: /\bcardnumber\b/i, label: 'cardNumber' },
  { pattern: /\bcc[_-]?num(ber)?\b/i, label: 'cc_number' },
  { pattern: /card[_-]?cvv|card[_-]?cvc/i, label: 'card_cvv/card_cvc' },
  { pattern: /\bcvv\b|\bcvc\b/i, label: 'cvv/cvc' },
  { pattern: /security[_-]?code/i, label: 'security_code' },
  { pattern: /\bcardholder[_-]?(pan|number)\b/i, label: 'cardholder_number' },
];

export interface RawCardFinding {
  label: string;
  line: string;
}

export function findRawCardFields(text: string): RawCardFinding[] {
  const out: RawCardFinding[] = [];
  for (const line of text.split('\n')) {
    for (const { pattern, label } of FORBIDDEN) {
      if (pattern.test(line)) out.push({ label, line: line.trim() });
    }
  }
  return out;
}

function walk(dir: string, predicate: (f: string) => boolean): string[] {
  let files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.next') continue;
    const full = join(dir, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) files = files.concat(walk(full, predicate));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

export async function run(_argv: string[] = []): Promise<CollectorResult> {
  const findings: string[] = [];

  // DB columns — a raw card column is the most serious scope violation.
  const schemaDir = join(REPO_ROOT, 'packages', 'db', 'src', 'schema');
  const schemaFiles = walk(schemaDir, (f) => f.endsWith('.ts'));

  // Web source — form inputs we render. Skip tests.
  const webDir = join(REPO_ROOT, 'apps', 'web', 'src');
  const webFiles = walk(
    webDir,
    (f) =>
      /\.(ts|tsx|svelte|vue)$/.test(f) &&
      !f.endsWith('.spec.ts') &&
      !f.endsWith('.test.ts') &&
      !/\.test\.tsx?$/.test(f),
  );

  for (const f of [...schemaFiles, ...webFiles]) {
    for (const hit of findRawCardFields(readFileSync(f, 'utf8'))) {
      findings.push(`raw card field "${hit.label}" in ${f.replace(REPO_ROOT, '.')}: ${hit.line}`);
    }
  }

  if (findings.length > 0) {
    return {
      status: 'fail',
      message: `${findings.length} raw cardholder-data field(s) — HARD FAIL (would force SAQ D)`,
      details: findings,
    };
  }
  return {
    status: 'ok',
    message: `no raw card fields in ${schemaFiles.length} schema + ${webFiles.length} web files (Stripe-only CDE boundary holds)`,
  };
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('verify-stripe-only', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('verify-stripe-only', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
