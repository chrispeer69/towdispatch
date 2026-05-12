#!/usr/bin/env node
/**
 * Entrypoint for `pnpm start` on Railway. Dispatches to the right app based on
 * RAILWAY_SERVICE_NAME, so the api and web services don't accidentally try to
 * boot each other (running both in parallel crashes the web service whenever
 * the api service's env vars are missing from the web container).
 *
 * For the api service we also run database migrations before the app starts,
 * because Railway's railpack auto-detected build does not honor the
 * preDeployCommand in apps/api/railway.toml. Without this, the api boots
 * against an empty schema and every query 500s with "relation does not exist".
 *
 * Migrations are tolerated to fail-fast: a bad migration crashes the container,
 * which Railway treats as a failed deploy and keeps the previous version
 * serving traffic.
 */
import { spawn, spawnSync } from 'node:child_process';

const svc = (process.env.RAILWAY_SERVICE_NAME ?? '').toLowerCase();

const TARGETS = {
  web: { filter: '@towcommand/web', script: 'start:prod', migrate: false },
  backend: { filter: '@towcommand/api', script: 'start:prod', migrate: true },
  api: { filter: '@towcommand/api', script: 'start:prod', migrate: true },
};

const target = TARGETS[svc];
if (!target) {
  process.stderr.write(
    `[railway-start] RAILWAY_SERVICE_NAME='${svc}' did not match any known target; ` +
      `defaulting to api. Known: ${Object.keys(TARGETS).join(', ')}\n`,
  );
}
const { filter, script, migrate } = target ?? TARGETS.api;

if (migrate) {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_ADMIN_URL) {
    process.stderr.write(
      '[railway-start] DATABASE_URL/DATABASE_ADMIN_URL not set; refusing to start api ' +
        'without a database. Set DATABASE_URL on this service.\n',
    );
    process.exit(1);
  }
  process.stdout.write('[railway-start] running migrations before api boot…\n');
  const m = spawnSync('pnpm', ['--filter', '@towcommand/db', 'run', 'migrate'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (m.status !== 0) {
    process.stderr.write(
      `[railway-start] migrations failed with exit code ${m.status}; aborting boot.\n`,
    );
    process.exit(m.status ?? 1);
  }
  process.stdout.write('[railway-start] migrations applied; starting api…\n');
}

process.stdout.write(
  `[railway-start] service='${svc}' → pnpm --filter ${filter} run ${script}\n`,
);

const child = spawn('pnpm', ['--filter', filter, 'run', script], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
