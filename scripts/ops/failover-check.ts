/**
 * failover-check.ts (Session 44) — read-only cross-region health probe.
 *
 * Pings each region's GET /ready and prints a status table: reachability,
 * region id/role, replication lag, and last-write marker. Flags any region
 * whose replica lag exceeds the alert threshold (RPO signal).
 *
 * Usage:
 *   tsx scripts/ops/failover-check.ts
 *   tsx scripts/ops/failover-check.ts --primary https://api.example.com/ready \
 *                                     --secondary https://api-west.example.com/ready
 *
 * Env fallbacks:
 *   PRIMARY_REGION_HEALTHCHECK_URL    primary /ready URL
 *   SECONDARY_REGION_HEALTHCHECK_URL  secondary /ready URL
 *   REPLICATION_LAG_ALERT_SECONDS     lag threshold (default 60)
 *
 * Exit codes: 0 = primary reachable; 1 = primary unreachable (consider failover);
 *             2 = no primary URL provided.
 *
 * Read-only. Performs NO cutover. Pure Node (no app imports), runs via tsx.
 */
const PROBE_TIMEOUT_MS = 4_000;

interface RegionHealth {
  regionId?: string;
  role?: string;
  replicaLagSeconds?: number | null;
  lastWriteTs?: string | null;
}
interface Probe {
  label: string;
  url: string;
  reachable: boolean;
  status: number | null;
  health: RegionHealth | null;
}

function argOrEnv(flag: string, env: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] || undefined;
}

async function probe(label: string, url: string): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    let body: { region?: RegionHealth } | null = null;
    try {
      body = (await res.json()) as { region?: RegionHealth };
    } catch {
      body = null;
    }
    return { label, url, reachable: res.ok, status: res.status, health: body?.region ?? null };
  } catch {
    return { label, url, reachable: false, status: null, health: null };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const primaryUrl = argOrEnv('--primary', 'PRIMARY_REGION_HEALTHCHECK_URL');
  const secondaryUrl = argOrEnv('--secondary', 'SECONDARY_REGION_HEALTHCHECK_URL');
  const lagThreshold = Number(process.env.REPLICATION_LAG_ALERT_SECONDS ?? '60');

  if (!primaryUrl) {
    process.stderr.write(
      'failover-check: no primary URL (--primary or PRIMARY_REGION_HEALTHCHECK_URL)\n',
    );
    process.exit(2);
  }

  const targets: Array<{ label: string; url: string }> = [{ label: 'primary', url: primaryUrl }];
  if (secondaryUrl) targets.push({ label: 'secondary', url: secondaryUrl });

  const results = await Promise.all(targets.map((t) => probe(t.label, t.url)));

  process.stdout.write('\nRegion health check\n===================\n');
  for (const r of results) {
    const h = r.health;
    const lag = h?.replicaLagSeconds ?? null;
    const lagFlag = lag !== null && lag > lagThreshold ? `  ⚠ LAG > ${lagThreshold}s` : '';
    process.stdout.write(
      `\n[${r.label}] ${r.url}\n` +
        `  reachable:       ${r.reachable} (status ${r.status ?? 'n/a'})\n` +
        `  regionId/role:   ${h?.regionId ?? '?'} / ${h?.role ?? '?'}\n` +
        `  replicaLagSec:   ${lag ?? 'n/a'}${lagFlag}\n` +
        `  lastWriteTs:     ${h?.lastWriteTs ?? 'n/a'}\n`,
    );
  }

  const primary = results.find((r) => r.label === 'primary');
  process.stdout.write('\n');
  if (!primary?.reachable) {
    process.stdout.write('RESULT: primary UNREACHABLE — consult docs/ops/region-failover.md\n');
    process.exit(1);
  }
  process.stdout.write('RESULT: primary reachable — no action needed\n');
}

main().catch((err) => {
  process.stderr.write(
    `failover-check FAILED: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
