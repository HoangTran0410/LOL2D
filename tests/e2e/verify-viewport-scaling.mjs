/**
 * The viewport-scaling claim, measured on two real viewports.
 *
 * The spec's headline is "every screen shows at least the player's full
 * vision circle", so this measures the *visible world span* rather than
 * `camera.scale`: the scale is the implementation, the span is the promise. A
 * script asserting the scale would keep passing if `getBoundingBox` stopped
 * agreeing with it, which is the only way the promise can break while the
 * arithmetic still looks right.
 *
 *   node tests/e2e/verify-viewport-scaling.mjs
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

/** Kept in step with `Camera.ts` by hand: node cannot import the TS module. */
const VISION_SPAN = 1000;

const PHONE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const baseUrl = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });

const failures = [];
const report = {};
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Boots a match and returns the page, at `viewport`. */
const openMatch = async (viewport, query = '') => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  await page.goto(`${baseUrl}${query}`, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.camera, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
  return page;
};

const spanAt = async (page, viewport) => {
  await page.setViewportSize(viewport);
  // The resize handler, and then the camera's 0.07/frame lerp toward it — a
  // 0.39 -> 0.9 move needs some 60 frames to settle inside 1%.
  await page.waitForTimeout(2_000);
  return page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const box = game.camera.getBoundingBox();
    return {
      w: box.w,
      h: box.h,
      scale: game.camera.currentScale,
      zoomFactor: game.camera.zoomFactor,
    };
  });
};

try {
  const page = await openMatch(PHONE);

  const phone = await spanAt(page, PHONE);
  const desktop = await spanAt(page, DESKTOP);
  report.phone = phone;
  report.desktop = desktop;

  // 1. The same vertical world on both — the whole point of the feature.
  const drift = Math.abs(phone.h - desktop.h) / Math.max(phone.h, desktop.h);
  check(
    'the vertical world span matches within 2% between a phone and a desktop',
    drift <= 0.02,
    `phone ${phone.h.toFixed(1)} vs desktop ${desktop.h.toFixed(1)} (${(drift * 100).toFixed(2)}%)`
  );

  // 2. And that span is at least the full vision circle, not merely equal.
  check(
    `both viewports show at least the full vision circle (${VISION_SPAN})`,
    phone.h >= VISION_SPAN - 1 && desktop.h >= VISION_SPAN - 1,
    `phone ${phone.h.toFixed(1)}, desktop ${desktop.h.toFixed(1)}`
  );

  // 3. The desktop zoomed *in*. This is the half of the fix people do not
  //    expect, and the half a "just clamp the phone" implementation misses.
  check(
    'the desktop is scaled in relative to the phone',
    desktop.scale > phone.scale,
    `phone ${phone.scale.toFixed(3)} vs desktop ${desktop.scale.toFixed(3)}`
  );

  // 5 (part one). Going back to the phone restores the phone's span, so the
  //    recompute is not one-way.
  const phoneAgain = await spanAt(page, PHONE);
  report.phoneAgain = phoneAgain;
  check(
    'returning to the phone viewport restores its span',
    Math.abs(phoneAgain.h - phone.h) / phone.h <= 0.02,
    `${phoneAgain.h.toFixed(1)} vs ${phone.h.toFixed(1)}`
  );
  check(
    'the manual zoom factor is unchanged across every resize',
    phone.zoomFactor === 1 && desktop.zoomFactor === 1 && phoneAgain.zoomFactor === 1,
    `${phone.zoomFactor} / ${desktop.zoomFactor} / ${phoneAgain.zoomFactor}`
  );
  await page.close();

  // 4. `?zoom=` pins the factor: zooming in shows less world, and the result
  //    stays inside the clamp.
  const zoomed = await openMatch(PHONE, '?zoom=1.6');
  const zoomedSpan = await spanAt(zoomed, PHONE);
  report.zoomed = zoomedSpan;
  check(
    '?zoom=1.6 is applied and shrinks the visible world',
    zoomedSpan.zoomFactor === 1.6 && zoomedSpan.h < phone.h,
    `factor ${zoomedSpan.zoomFactor}, span ${zoomedSpan.h.toFixed(1)} vs ${phone.h.toFixed(1)}`
  );
  check(
    'the zoomed scale stays inside the clamp',
    zoomedSpan.scale >= 0.3 && zoomedSpan.scale <= 2.5,
    `${zoomedSpan.scale.toFixed(3)}`
  );
  await zoomed.close();
} catch (error) {
  failures.push(`threw: ${error.stack ?? error}`);
} finally {
  console.log('\n--- report ---');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.log('\n--- FAILURES ---');
    for (const failure of failures) console.log(failure);
  } else {
    console.log('\nall checks passed');
  }
  await browser.close();
  await server.close();
  process.exit(failures.length ? 1 : 0);
}
