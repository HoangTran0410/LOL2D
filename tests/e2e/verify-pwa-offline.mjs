/**
 * Does the installed app actually open with no network?
 *
 * The only question that matters about the PWA work, and the only one Vitest
 * structurally cannot answer: it needs a real service worker, a real cache
 * storage, and a real offline toggle. Everything else about the feature — the
 * manifest, the precache list, the version stamp — can be wrong in ways a
 * build log looks fine about, and the failure only shows up on a phone in a
 * lift.
 *
 * Specifically, this is what would have caught p5 still being on its CDN: the
 * page would serve from cache and then white-screen, because nothing draws
 * without p5. (stats.js was vendored beside it for the same reason and has
 * since been deleted outright — a dev-only FPS HUD is not worth a blocking
 * script and a precache entry on every player's boot.)
 *
 *   npm run build && node tests/e2e/verify-pwa-offline.mjs
 *
 * Requires a system Chrome install.
 */
import { preview } from 'vite';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');

/**
 * How many distinct URLs `dist/sw.js`'s own precache manifest declares —
 * the honest floor for "precache is populated", derived from this build's
 * actual output rather than pinned to one configuration's file count.
 *
 * `CacheStorage` is keyed by URL, so a duplicate collapses to one entry at
 * runtime. The generated manifest has one, deterministically: workbox's
 * `generateSW` plugin lists `manifest.webmanifest` and all seven
 * `favicon/*` icons twice — once from the asset glob, once from the PWA
 * icon list it reads separately for the manifest it generates — in both a
 * pack-present and a pack-free build, since neither pack touches the
 * favicon set. Counting raw entries instead of unique URLs would overcount
 * by exactly that duplication no matter how many files a build ships, so
 * `cached` would never equal it and the check would need a fudge factor to
 * pass at all. Deduping here is what makes an *exact* match honest instead
 * of a guess.
 *
 * This is a real external check, not a self-fulfilling one: `cached` comes
 * from the running service worker's actual `CacheStorage` at runtime, while
 * this reads the manifest `sw.js` itself declares. A service worker that
 * fails to cache everything it promised — a quota error, a dropped fetch, a
 * install that partially completes — moves one without moving the other.
 */
const declaredPrecacheCount = () => {
  const source = readFileSync(join(distDir, 'sw.js'), 'utf8');
  const urls = [...source.matchAll(/\{url:"([^"]+)"/g)].map(match => match[1]);
  return new Set(urls).size;
};

const server = await preview({ preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const failures = [];
let summary = 'did not finish';
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

/** Whether the menu has actually rendered — the app booted, not just responded. */
const menuIsUp = () =>
  page.waitForSelector('#play-btn', { timeout: 30_000 }).then(
    () => true,
    () => false
  );

try {
  // ---------------------------------------------------------------- online
  await page.goto(url, { waitUntil: 'load' });
  check('menu renders online', await menuIsUp());

  const version = await page.textContent('#menu-version').catch(() => null);
  check('version stamp is on the menu', Boolean(version?.trim().startsWith('v')), version?.trim());

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  check('service worker is active', registered);

  // Workbox precaches in the background; the count is the whole point, so wait
  // for it to settle rather than sampling whatever it has got to so far.
  const cached = await page.evaluate(async () => {
    const deadline = Date.now() + 60_000;
    let count = 0;
    let stable = 0;
    while (Date.now() < deadline && stable < 3) {
      const names = await caches.keys();
      let total = 0;
      for (const name of names) total += (await (await caches.open(name)).keys()).length;
      stable = total === count && total > 0 ? stable + 1 : 0;
      count = total;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return count;
  });
  const expectedPrecache = declaredPrecacheCount();
  check(
    'precache is populated',
    cached === expectedPrecache,
    `${cached} of ${expectedPrecache} declared entries cached`
  );

  // A reload is what puts the worker in control of the page; without it the
  // first load is still coming straight off the network.
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check('worker controls the page after a reload', controlled);

  // --------------------------------------------------------------- offline
  //
  // Clearing the HTTP cache first, and this is load-bearing: `setOffline` only
  // cuts the network, so Chromium will happily keep answering from its own
  // disk cache and a file that never reached the *service worker* cache still
  // appears to work. Without this the check passes with p5 back on its CDN —
  // measured, by putting it back. A real install, opened days later with that
  // cache long evicted, gets no such help.
  await (await context.newCDPSession(page)).send('Network.clearBrowserCache');
  await context.setOffline(true);
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error)));

  await page.reload({ waitUntil: 'load' });
  check('menu renders offline', await menuIsUp());

  const globals = await page.evaluate(() => ({
    p5: typeof window.createVector === 'function',
    // stats.js is deliberately gone, not merely unused: nothing may put a
    // second blocking vendor script back on the boot path for a dev-only HUD.
    stats: typeof window.Stats,
  }));
  check('p5 globals present offline', globals.p5);
  check('stats.js is not shipped at all', globals.stats === 'undefined', globals.stats);
  check('no page errors offline', consoleErrors.length === 0, consoleErrors[0] ?? '');

  // The real thing: start a match with the network off.
  const inGame = await page
    .click('#play-btn', { timeout: 30_000 })
    .then(() =>
      page.waitForFunction(() => document.querySelector('canvas') !== null, { timeout: 60_000 })
    )
    .then(
      () => true,
      () => false
    );
  check('a match starts offline', inGame);

  summary = `offline=${cached} cached entries`;
} catch (error) {
  // Recorded rather than thrown: a run that dies halfway still has to end in
  // the one line that says what happened, or the failure is a stack trace
  // nobody reads to the bottom of.
  check('run completed', false, String(error).split('\n')[0]);
} finally {
  await browser.close();
  await server.httpServer.close();
  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}  ${summary}`);
}

process.exit(failures.length === 0 ? 0 : 1);
