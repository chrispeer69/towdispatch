/**
 * PCI DSS evidence — no Primary Account Number (PAN) in source or logs
 * (Req 3.4 render PAN unreadable; Req 10 don't log it).
 *
 * Asserts two things across the payment code path and any runtime log files:
 *   1. no Luhn-valid 13–19 digit PAN literal appears (a card number committed or
 *      logged), and
 *   2. the payment module never passes a card-field identifier to a logger.
 *
 * A positive match is a HARD FAIL even without --strict: a leaked PAN is never an
 * acceptable "warn". Well-known public test cards (Stripe's 4242…, etc.) are
 * allowlisted — they are non-sensitive by design and appear in fixtures.
 *
 * The detectors (findPanCandidates / findCardFieldLogging) are pure so they
 * unit-test on canned strings; run() walks the files.
 *
 * Usage:
 *   tsx scripts/compliance/verify-no-pan-logs.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type CollectorResult, exitCodeFor, fileURLToPath, isMain, printResult } from './_util';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Public, non-sensitive test PANs (Stripe + common gateways). */
export const TEST_CARD_ALLOWLIST = new Set([
  '4242424242424242',
  '4000056655665556',
  '5555555555554444',
  '5105105105105100',
  '378282246310005',
  '371449635398431',
  '6011111111111117',
  '4111111111111111',
  '4000002500003155',
  '4000000000009995',
]);

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export interface PanMatch {
  raw: string;
  masked: string;
}

/** Find Luhn-valid 13–19 digit PAN-shaped runs, excluding allowlisted test cards. */
export function findPanCandidates(text: string): PanMatch[] {
  const out: PanMatch[] = [];
  // A contiguous 13–19 digit run, OR a 4-4-4-4(-x) grouping with single space/dash
  // separators (how PANs are commonly written). Deliberately NOT a per-digit
  // separator class — that over-matches space-separated numeric noise in source.
  const re = /(?<![\d.])(\d{13,19}|\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,4})?)(?![\d.])/g;
  for (const m of text.matchAll(re)) {
    const digits = (m[1] ?? '').replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    // Payment-card Major Industry Identifier: real PANs lead with 3 (Amex/travel),
    // 4 (Visa), 5 (Mastercard), or 6 (Discover). Excludes IDs/amounts/timestamps.
    if (!/[3-6]/.test(digits.charAt(0))) continue;
    // Reject all-same-digit runs (0000…, 1111…) — Luhn-valid but never a real PAN.
    if (/^(\d)\1+$/.test(digits)) continue;
    if (TEST_CARD_ALLOWLIST.has(digits)) continue;
    if (!luhnValid(digits)) continue;
    out.push({ raw: digits, masked: `${digits.slice(0, 6)}…${digits.slice(-4)}` });
  }
  return out;
}

const CARD_FIELD =
  /(card[_-]?number|\bpan\b|card[_-]?cvv|card[_-]?cvc|\bcvv\b|\bcvc\b|security[_-]?code)/i;
const LOGGER_CALL =
  /(console\.(log|info|warn|error|debug)|(?:this\.)?(log|logger)\.(log|info|warn|error|debug|trace))\s*\(/i;

/** Lines where a logger call and a card-field identifier appear together. */
export function findCardFieldLogging(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split('\n')) {
    if (LOGGER_CALL.test(line) && CARD_FIELD.test(line)) hits.push(line.trim());
  }
  return hits;
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
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
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

  // 1. PAN literals in runtime log files (anywhere) and the payments source.
  const logFiles = walk(REPO_ROOT, (f) => f.endsWith('.log'));
  const paymentsDir = join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'payments');
  const paymentSrc = walk(
    paymentsDir,
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'),
  );

  for (const f of [...logFiles, ...paymentSrc]) {
    const pans = findPanCandidates(readFileSync(f, 'utf8'));
    for (const p of pans)
      findings.push(`PAN-shaped value ${p.masked} in ${f.replace(REPO_ROOT, '.')}`);
  }

  // 2. Card-field identifiers reaching a logger anywhere in the payments source.
  for (const f of paymentSrc) {
    for (const line of findCardFieldLogging(readFileSync(f, 'utf8'))) {
      findings.push(`card field logged in ${f.replace(REPO_ROOT, '.')}: ${line}`);
    }
  }

  if (findings.length > 0) {
    return {
      status: 'fail',
      message: `${findings.length} PCI PAN-exposure finding(s) — HARD FAIL`,
      details: findings,
    };
  }
  return {
    status: 'ok',
    message: `no PAN literals or card-field logging in ${paymentSrc.length} payment files + ${logFiles.length} log files`,
  };
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('verify-no-pan-logs', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('verify-no-pan-logs', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
