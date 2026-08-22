/**
 * The boot every Playwright driver in this directory used to write out for
 * itself: a Vite dev server on a free port, system Chrome, a page at a chosen
 * viewport, page-error capture, a CDP session for real touch, and the
 * `check()` / `failures` / `report` bookkeeping that turns a run into a
 * numeric summary.
 *
 * It exists because the three touch drivers had drifted into *byte-identical*
 * preambles — 32 lines of code, three copies, plus a fourth made by hand in a
 * stray `_s.mjs` — and four more scripts carried the same thing with a
 * different viewport. None of that is the part any script is testing, but it
 * was the part that had to be edited N times whenever `src/` moved.
 * `tests/scripts/e2eHarness.test.ts` is what keeps it that way, and unlike the
 * scripts here it runs inside `npm run verify`.
 *
 * Deliberately *not* covering the two scripts that boot differently, because
 * folding them in would mean this module growing a mode for each:
 *
 *   - `drive-game.mjs` spawns `npx vite` as a child process and honours
 *     `LOL2D_URL` / `LOL2D_PORT` so it can be pointed at an already-running
 *     server. That is a different contract, not a different option.
 *   - `verify-pwa-offline.mjs` serves the *built* `dist/` through `preview()`,
 *     never touches `window.__lol2d`, and cuts the network on purpose. A dev
 *     server would invalidate the only thing it asks.
 *
 * `hmr: false` is not a detail: this repo is worked on by several agents in one
 * tree, and a stray save anywhere in `src/` makes Vite reload the page
 * mid-run, which wipes whatever match the script had built.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

/** iPhone 14 held sideways, in CSS pixels. */
export const PHONE_VIEWPORT = { width: 844, height: 390 };

/** The desktop frame the non-mobile drivers assert layout against. */
export const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

export const CFG_KEY = 'lol2d:pregameConfig:v1';
export const KITS_KEY = 'lol2d:savedKits:v1';

/**
 * Boots the server and the browser and hands back everything a driver needs.
 *
 * `touch: true` appends `?touch=1`, which is how `GameScene` is told to use the
 * Wild Rift controls — separate from `hasTouch`, which is what makes the
 * *browser* emit touch events. A script can want either without the other:
 * `drive-practice-panel` runs a desktop viewport with `hasTouch` so it can tap
 * a HUD control, and never asks for the touch controls themselves.
 *
 * `deviceScaleFactor: 3` is worth passing on any phone-sized run: a HUD bug
 * where a badge overlapped its neighbour's hotkey was invisible at 1x.
 */
export const startHarness = async ({
  out,
  viewport = DESKTOP_VIEWPORT,
  hasTouch = false,
  deviceScaleFactor,
  touch = false,
} = {}) => {
  const server = await createServer({ server: { port: 0, strictPort: false, hmr: false } });
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}${touch ? '?touch=1' : ''}`;

  // System Chrome by default, because that is the browser the game ships to.
  // `LOL2D_CHROME_CHANNEL=` (empty) falls back to Playwright's own bundled
  // Chromium, which is what makes these scripts runnable on a machine — or in
  // CI — with no Chrome installed. Same idea as `drive-game.mjs`'s
  // `LOL2D_URL` / `LOL2D_PORT`: an override, never the default.
  const channel = process.env.LOL2D_CHROME_CHANNEL ?? 'chrome';
  const browser = await chromium.launch(channel ? { channel } : {});
  const page = await browser.newPage({
    viewport,
    hasTouch,
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
  });

  const errors = [];
  const watch = (target, label = '') => {
    const tag = label ? `(${label})` : '';
    target.on('pageerror', error => errors.push(`pageerror${tag}: ${error.message}`));
    target.on('console', message => {
      if (message.type() === 'error') errors.push(`console${tag}: ${message.text()}`);
    });
    return target;
  };
  watch(page);

  const report = {};
  const failures = [];
  const check = (name, passed, detail) => {
    if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };

  const cdp = await page.context().newCDPSession(page);

  /**
   * Real touch events down the browser's own input pipeline.
   *
   * CDP requires touchEnd to carry no points, so a gesture here lifts every
   * finger at once — which is what the game's own handlers see from a real
   * screen too.
   */
  const dispatch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((point, index) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
        id: point.id ?? index,
        radiusX: 14,
        radiusY: 14,
        force: 1,
      })),
    });
  const touchStart = points => dispatch('touchStart', points);
  const touchMove = points => dispatch('touchMove', points);
  const touchEnd = () => dispatch('touchEnd', []);
  const tap = async (x, y, holdMs = 70) => {
    await touchStart([{ x, y }]);
    await page.waitForTimeout(holdMs);
    await touchEnd();
  };

  /**
   * A second page in its own context, for a script that has to compare the
   * same screen at two viewports or under a finger versus a mouse. Errors from
   * it land in the same list, tagged, so `check('no runtime errors', …)` still
   * covers it.
   */
  const openPage = async ({ viewport: extraViewport, hasTouch: extraTouch = false, label }) => {
    const context = await browser.newContext({ viewport: extraViewport, hasTouch: extraTouch });
    const extraPage = watch(await context.newPage(), label ?? (extraTouch ? 'touch' : 'pointer'));
    return { context, page: extraPage };
  };

  /**
   * The tail every driver shared: dump the report, show the first page errors,
   * say where the frames went, then close both and exit non-zero if anything
   * failed. Prefer `guard()` below over calling this directly from a script's
   * own `try`/`finally` — see its doc comment for why.
   */
  const finish = async () => {
    console.log('\n--- report ---');
    console.log(JSON.stringify(report, null, 2));
    if (errors.length) {
      console.log('\n--- page errors ---');
      for (const error of errors.slice(0, 10)) console.log(error);
    }
    if (out) console.log(`\nscreenshots: ${out}-*.png`);
    if (failures.length) {
      console.log('\n--- FAILURES ---');
      for (const failure of failures) console.log(failure);
    } else {
      console.log('\nall checks passed');
    }
    await browser.close();
    await server.close();
    process.exit(failures.length ? 1 : 0);
  };

  /**
   * The only safe way to run a driver's body.
   *
   * `finish()` calls `process.exit()`, and `process.exit()` inside a `finally`
   * terminates the process before an in-flight exception can propagate. So a
   * script written as `try { ...checks... } finally { await finish(); }` —
   * with no `catch` — reaches `finally` after a throw, finds `failures` still
   * empty because the throw happened before any check recorded one, prints
   * "all checks passed", and exits 0. It ran a prefix of its checks and
   * reported success for the whole thing. `page.click(selector)` on a
   * selector that does not exist is the commonest way in, and it is very
   * often the exact thing the script is testing.
   *
   * `guard(body)` is the fix: it is the only place allowed to call `finish()`,
   * and it always reaches it through a `catch` that has already turned the
   * throw into a recorded failure. A script's whole body becomes
   * `await guard(async () => { ...checks... });` — no bare `try`/`finally`
   * left for the next author to get wrong.
   *
   * `cleanup`, if given, runs after the body (pass or throw) and before
   * `finish()` — for a script that has its own teardown beyond the browser
   * and server (`drive-practice-panel.mjs` clears two `localStorage` keys so
   * they cannot leak into the next script in the suite). A `cleanup` that
   * itself throws is recorded as its own failure rather than replacing
   * whatever the body already recorded, and `finish()` still runs after it.
   */
  const guard = async (body, { cleanup } = {}) => {
    try {
      await body();
    } catch (error) {
      failures.push(`threw: ${error?.stack ?? error?.message ?? error}`);
    } finally {
      if (cleanup) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(`cleanup failed: ${error?.message ?? error}`);
        }
      }
      await finish();
    }
  };

  return {
    url,
    server,
    browser,
    page,
    cdp,
    errors,
    report,
    failures,
    check,
    dispatch,
    touchStart,
    touchMove,
    touchEnd,
    tap,
    openPage,
    finish,
    guard,
  };
};
