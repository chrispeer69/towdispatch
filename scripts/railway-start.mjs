#!/usr/bin/env node
/**
 * Entrypoint for `pnpm start` on Railway. Dispatches to the right app based on
 * RAILWAY_SERVICE_NAME, so the api and web services don't accidentally try to
 * boot each other (running both in parallel crashes the web service whenever
 * the api service's env vars are missing from the web container).
 */
import { spawn } from 'node:child_process';

const svc = (process.env.RAILWAY_SERVICE_NAME ?? '').toLowerCase();

const TARGETS = {
  web: ['@towcommand/web', 'start:prod'],
  backend: ['@towcommand/api', 'start:prod'],
  api: ['@towcommand/api', 'start:prod'],
};

const target = TARGETS[svc];
if (!target) {
  process.stderr.write(
    `[railway-start] RAILWAY_SERVICE_NAME='${svc}' did not match any known target; ` +
      `defaulting to api. Known: ${Object.keys(TARGETS).join(', ')}\n`,
  );
}
const [filter, script] = target ?? TARGETS.api;
process.stdout.write(`[railway-start] service='${svc}' → pnpm --filter ${filter} run ${script}\n`);

const child = spawn('pnpm', ['--filter', filter, 'run', script], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
