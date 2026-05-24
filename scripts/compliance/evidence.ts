/**
 * Evidence model for the SOC 2 Type II continuous-collection pipeline (Session 40).
 *
 * Type I (Session 31) proved controls were *designed* as of a date. Type II
 * proves they *operated effectively* over a period — which requires dated,
 * retained evidence produced on a cadence, not a one-shot snapshot. This module
 * is the shared shape every automated collector emits, plus the helpers that
 * write a day's evidence + manifest under compliance/evidence/automated/<date>/.
 *
 * An EvidenceItem wraps a collector's CollectorResult (same ok/warn/skip/fail
 * vocabulary as _util.ts) with the structured `data` an auditor inspects and the
 * control it maps to. The manifest is the index a Type II auditor pulls first.
 *
 * Retention: evidence is git-tracked and committed by the scheduled workflow
 * (.github/workflows/compliance-evidence.yml), so the repository history IS the
 * retention store — see RETENTION_MONTHS and SESSION_40_DECISIONS.md (D4/D5).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectorResult, Status } from './_util';

/** Minimum retention for Type II evidence (months). See D4. */
export const RETENTION_MONTHS = 18;

export interface EvidenceItem {
  /** Stable collector id; also the evidence filename (`<id>.json`). */
  id: string;
  /** SOC 2 control / TSC reference this evidence supports (e.g. "CC6.1"). */
  control: string;
  status: Status;
  message: string;
  details?: string[];
  /** Structured payload an auditor can inspect: counts, samples, timestamps. */
  data?: Record<string, unknown>;
  /** ISO-8601 collection time. */
  collectedAt: string;
}

export interface EvidenceManifestEntry {
  id: string;
  control: string;
  status: Status;
  message: string;
  file: string;
}

export interface EvidenceManifest {
  generatedAt: string;
  /** Observation-window label, e.g. "type-ii-12mo". */
  window: string;
  retentionMonths: number;
  summary: Record<Status, number>;
  items: EvidenceManifestEntry[];
}

/** Lift a collector's CollectorResult into a dated, control-tagged EvidenceItem. */
export function toEvidence(
  id: string,
  control: string,
  result: CollectorResult,
  data?: Record<string, unknown>,
  collectedAt: string = new Date().toISOString(),
): EvidenceItem {
  const item: EvidenceItem = {
    id,
    control,
    status: result.status,
    message: result.message,
    collectedAt,
  };
  if (result.details) item.details = result.details;
  if (data) item.data = data;
  return item;
}

/** Tally items by status — drives the manifest summary and the smoke gate. */
export function summarize(items: EvidenceItem[]): Record<Status, number> {
  return items.reduce<Record<Status, number>>(
    (acc, it) => {
      acc[it.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, skip: 0, fail: 0 },
  );
}

/** Build the manifest index for a day's evidence set. */
export function buildManifest(
  items: EvidenceItem[],
  window: string,
  generatedAt: string = new Date().toISOString(),
): EvidenceManifest {
  return {
    generatedAt,
    window,
    retentionMonths: RETENTION_MONTHS,
    summary: summarize(items),
    items: items.map((it) => ({
      id: it.id,
      control: it.control,
      status: it.status,
      message: it.message,
      file: `${it.id}.json`,
    })),
  };
}

/** `<root>/compliance/evidence/automated/<YYYY-MM-DD>`. Created if absent. */
export function evidenceDir(repoRoot: string, date: string): string {
  const dir = join(repoRoot, 'compliance', 'evidence', 'automated', date);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write one evidence item as pretty JSON; returns the file path written. */
export function writeEvidenceItem(dir: string, item: EvidenceItem): string {
  const path = join(dir, `${item.id}.json`);
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`, 'utf8');
  return path;
}

/** Write the manifest index for a day's run; returns the file path written. */
export function writeManifest(dir: string, manifest: EvidenceManifest): string {
  const path = join(dir, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}
