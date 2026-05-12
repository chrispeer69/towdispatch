// Detailed runner: dumps any non-passing audit for the requested category.
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
const [, , url = 'http://localhost:3000/login', category = 'accessibility'] = process.argv;
const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
try {
  const res = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    onlyCategories: [category],
    logLevel: 'error',
  });
  const cat = res.lhr.categories[category];
  process.stdout.write(`score: ${Math.round(cat.score * 100)}\n`);
  for (const ref of cat.auditRefs) {
    const a = res.lhr.audits[ref.id];
    if (!a || a.score === null || a.score === 1) continue;
    process.stdout.write(`  ❌ ${a.id} (${a.score}): ${a.title}\n`);
    if (a.details && 'items' in a.details && a.details.items) {
      for (const item of a.details.items.slice(0, 3)) {
        process.stdout.write(`     - ${JSON.stringify(item).slice(0, 200)}\n`);
      }
    }
  }
} finally {
  await chrome.kill();
}
