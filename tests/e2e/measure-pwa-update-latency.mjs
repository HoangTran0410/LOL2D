/**
 * How long from reopening the app to the player actually seeing "there is an
 * update" — the question behind
 * https://github.com/… "sao phần check pwa có bản mới ... chậm quá".
 *
 * Does NOT use `tests/e2e/harness.mjs`: like `verify-pwa-offline.mjs`, this
 * needs two independently-built `dist/` trees and a static server it can
 * swap files under mid-run, which the shared harness's single dev server
 * has no shape for.
 *
 *   npm run e2e:pwa-update
 *
 * What this simulates, and why:
 *
 *  - v1 is the current source, built and installed — an already-installed
 *    player. v2 is v1 plus one real (non-comment; a build strips comments)
 *    line inside `Game`'s constructor, which is enough to change the shared
 *    `game` chunk's content hash — and because every per-champion
 *    `spell-*.js` chunk imports `game` *by that hashed filename*, changing
 *    it cascades into a new hash for every spell chunk too, even though no
 *    spell's own code changed. This is not a worst case: it is what a
 *    typical commit here does (measured directly against two real commits
 *    14 apart: 65 changed files, ~1.2MB — this synthetic bump lands in the
 *    same range). See `src/pwa/updates.ts`'s header comment.
 *
 *  - The v2 files are swapped into the *same* served directory after v1 is
 *    already controlling the page, standing in for "a deploy happened while
 *    this device was closed/idle" — then the page is reopened fresh, exactly
 *    like tapping the home-screen icon again.
 *
 *  - Every request in the browser context — including the service worker's
 *    own background precache fetches, confirmed separately to route through
 *    Playwright's interception — is delayed by `THROTTLE_LATENCY_MS` plus
 *    its body size over `THROTTLE_BYTES_PER_MS`, approximating a middling
 *    mobile connection (Chrome DevTools' "Fast 3G" preset: ~200KB/s,
 *    +150ms). CDP's `Network.emulateNetworkConditions` was tried first and
 *    rejected: it only throttles the page's own fetches, not the service
 *    worker's, so it could not reproduce the reported delay at all.
 *
 * Two numbers matter: time to `#menu-update-checking` (the fast signal —
 * new in this change) and time to `#menu-update-btn` (the actionable one,
 * unchanged — and unchanged on purpose, since applying an update before its
 * download has finished has nothing to skip-wait to).
 */
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const serveDir = resolve(root, 'dist-measure-update');
const bumpFile = resolve(root, 'src/game/Game.ts');
const bumpAnchor = '  constructor(plan?: MatchPlan) {';

/** ~200KB/s: Chrome DevTools' "Fast 3G" download throughput. */
const THROTTLE_BYTES_PER_MS = (200 * 1024) / 1000;
/** Chrome DevTools' "Fast 3G" round-trip latency. */
const THROTTLE_LATENCY_MS = 150;

const failures = [];
let summary = 'did not finish';
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const buildInto = async outDir => {
  rmSync(resolve(root, 'dist'), { recursive: true, force: true });
  await build({ root, build: { outDir: 'dist' }, logLevel: 'silent' });
  rmSync(outDir, { recursive: true, force: true });
  cpSync(resolve(root, 'dist'), outDir, { recursive: true });
};

const waitForPrecacheStable = page =>
  page.evaluate(async () => {
    const deadline = Date.now() + 60_000;
    let count = 0;
    let stable = 0;
    while (Date.now() < deadline && stable < 3) {
      const names = await caches.keys();
      let total = 0;
      for (const name of names) total += (await (await caches.open(name)).keys()).length;
      stable = total === count && total > 0 ? stable + 1 : 0;
      count = total;
      await new Promise(r => setTimeout(r, 500));
    }
    return count;
  });

let server;
let browser;
try {
  console.log('building v1 (current source)...');
  await buildInto(serveDir);

  server = await preview({
    root,
    build: { outDir: 'dist-measure-update' },
    preview: { port: 0, strictPort: false },
    logLevel: 'silent',
  });
  const url = server.resolvedUrls.local[0];

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'load' });
  check(
    'menu renders (v1)',
    await page.waitForSelector('#play-btn', { timeout: 30_000 }).then(
      () => true,
      () => false
    )
  );
  await waitForPrecacheStable(page);
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check('service worker controls the page after install', controlled);

  console.log('building v2 (real content bump under src/game/)...');
  const original = readFileSync(bumpFile, 'utf8');
  check('bump anchor found in Game.ts', original.includes(bumpAnchor));
  writeFileSync(
    bumpFile,
    original.replace(bumpAnchor, `${bumpAnchor}\n    console.debug('e2e-update-bump', Date.now());`)
  );
  try {
    await buildInto(serveDir);
  } finally {
    writeFileSync(bumpFile, original);
  }

  let totalBytes = 0;
  let totalReqs = 0;
  await context.route('**/*', async route => {
    const response = await route.fetch();
    const body = await response.body();
    totalBytes += body.length;
    totalReqs += 1;
    const delay = THROTTLE_LATENCY_MS + body.length / THROTTLE_BYTES_PER_MS;
    await new Promise(r => setTimeout(r, delay));
    await route.fulfill({ response, body });
  });

  console.log('reopening app (throttled, real diff already on the server)...');
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });

  const downloadingAt = await page
    .waitForSelector('#menu-update-checking', { state: 'visible', timeout: 60_000 })
    .then(() => Date.now() - t0)
    .catch(() => null);
  const readyAt = await page
    .waitForSelector('#menu-update-btn', { state: 'visible', timeout: 120_000 })
    .then(() => Date.now() - t0)
    .catch(() => null);

  check('menu-update-checking (fast signal) appears', downloadingAt !== null, `${downloadingAt}ms`);
  check('menu-update-btn (actionable) appears', readyAt !== null, `${readyAt}ms`);
  check(
    'the fast signal genuinely leads the actionable one',
    downloadingAt !== null && readyAt !== null && downloadingAt < readyAt,
    `checking=${downloadingAt}ms btn=${readyAt}ms`
  );
  // Generous: this is not a claim about exact timing, only that the fast
  // signal is not itself gated behind the whole download the way the old,
  // single-signal design was (measured at ~19.4s for a comparable diff).
  check(
    'fast signal lands well under the old single-signal latency',
    downloadingAt !== null && downloadingAt < 8000,
    `${downloadingAt}ms`
  );

  console.log(
    `\nthrottled requests: ${totalReqs}, bytes: ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`
  );
  summary = `checking=${downloadingAt}ms btn=${readyAt}ms over ${totalReqs} throttled requests`;
} catch (error) {
  check('run completed', false, String(error).split('\n')[0]);
} finally {
  await browser?.close();
  await server?.httpServer.close();
  rmSync(resolve(root, 'dist'), { recursive: true, force: true });
  rmSync(serveDir, { recursive: true, force: true });
  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}  ${summary}`);
}

process.exit(failures.length === 0 ? 0 : 1);
