/**
 * SOC 2 Type II evidence — monitoring/alerting operating effectiveness (CC4.1, CC7.2).
 *
 * Type II must show monitoring *operated* — that the health/metrics surface the
 * alerting stack scrapes was actually live and answering during the window. This
 * collector takes a point-in-time sample of the API health endpoint and records
 * the observed status + latency as dated evidence. Run daily by the evidence
 * cron, the accumulated samples are the "monitoring was up" record an auditor
 * pulls.
 *
 * Source resolution (first configured wins):
 *   1. MONITORING_HEALTH_URL — explicit health endpoint.
 *   2. API_PUBLIC_URL + "/health".
 *   3. neither — SKIP (documented, non-fatal).
 *
 * The verdict logic (evaluateHealthSample) is pure so it unit-tests without a
 * live endpoint.
 *
 * Usage:
 *   tsx scripts/compliance/monitoring-sample.ts [--strict]
 */
import { type CollectorResult, type Status, exitCodeFor, isMain, printResult } from './_util';

export interface HealthSample {
  url: string;
  reachable: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  /** Parsed `status` field from the body, if the endpoint returns one. */
  reportedStatus: string | null;
}

export function evaluateHealthSample(
  sample: HealthSample,
  strict: boolean,
): { result: CollectorResult; data: HealthSample } {
  const details = [
    `url: ${sample.url}`,
    `http: ${sample.httpStatus ?? 'unreachable'}`,
    `latency: ${sample.latencyMs === null ? 'n/a' : `${sample.latencyMs}ms`}`,
    `reported status: ${sample.reportedStatus ?? 'n/a'}`,
  ];

  if (!sample.reachable || sample.httpStatus === null) {
    // Endpoint down at sample time is a real, fatal-in-strict monitoring gap.
    const status: Status = strict ? 'fail' : 'warn';
    return {
      result: { status, message: 'health endpoint unreachable at sample time', details },
      data: sample,
    };
  }
  const healthyBody =
    sample.reportedStatus === null || /^(ok|up|healthy|pass)$/i.test(sample.reportedStatus);
  if (sample.httpStatus >= 200 && sample.httpStatus < 300 && healthyBody) {
    return {
      result: { status: 'ok', message: `health endpoint up (${sample.httpStatus})`, details },
      data: sample,
    };
  }
  const status: Status = strict ? 'fail' : 'warn';
  return {
    result: {
      status,
      message: `health endpoint reported unhealthy (http ${sample.httpStatus}, body "${sample.reportedStatus}")`,
      details,
    },
    data: sample,
  };
}

async function sampleHealth(url: string): Promise<HealthSample> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - start;
    let reportedStatus: string | null = null;
    try {
      const body = (await res.json()) as { status?: string };
      reportedStatus = typeof body.status === 'string' ? body.status : null;
    } catch {
      reportedStatus = null; // non-JSON body is fine; HTTP status carries the signal
    }
    return { url, reachable: true, httpStatus: res.status, latencyMs, reportedStatus };
  } catch {
    return { url, reachable: false, httpStatus: null, latencyMs: null, reportedStatus: null };
  }
}

function resolveUrl(): string | null {
  if (process.env.MONITORING_HEALTH_URL) return process.env.MONITORING_HEALTH_URL;
  if (process.env.API_PUBLIC_URL) return `${process.env.API_PUBLIC_URL.replace(/\/$/, '')}/health`;
  return null;
}

export async function run(argv: string[] = []): Promise<CollectorResult> {
  const strict = argv.includes('--strict');
  const url = resolveUrl();
  if (!url) {
    return {
      status: 'skip',
      message: 'no monitoring target (set MONITORING_HEALTH_URL or API_PUBLIC_URL)',
    };
  }
  const sample = await sampleHealth(url);
  return evaluateHealthSample(sample, strict).result;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then((r) => {
      printResult('monitoring-sample', r);
      process.exit(exitCodeFor(r.status));
    })
    .catch((err: unknown) => {
      printResult('monitoring-sample', { status: 'fail', message: String(err) });
      process.exit(1);
    });
}
