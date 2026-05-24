import { launch } from 'chrome-launcher';
// Tiny Lighthouse runner that emits scores as JSON for the addendum.
// Usage: node apps/e2e/scripts/lighthouse-runner.mjs http://localhost:3000/login
import lighthouse from 'lighthouse';

const url = process.argv[2] ?? 'http://localhost:3000/login';
const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
try {
  const res = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    onlyCategories: ['performance', 'accessibility', 'best-practices'],
    logLevel: 'error',
  });
  const c = res.lhr.categories;
  process.stdout.write(
    `${JSON.stringify(
      {
        url,
        performance: Math.round(c.performance.score * 100),
        accessibility: Math.round(c.accessibility.score * 100),
        'best-practices': Math.round(c['best-practices'].score * 100),
        runtimeError: res.lhr.runtimeError?.message ?? null,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await chrome.kill();
}
