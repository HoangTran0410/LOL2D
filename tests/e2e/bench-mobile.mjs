/**
 * Frame-budget benchmark for the game on a phone.
 *
 * Every performance number this project has was taken on desktop Chrome. A
 * phone is several times slower, and "the game is laggy on mobile" is the
 * complaint this whole branch exists to answer — so this measures the same
 * systems under Chrome's CPU throttle, at a landscape phone viewport, with the
 * touch controls on and (in one pass) a thumb actually holding them.
 *
 * The throttle rate is a divisor: 4 means every piece of script runs four times
 * slower than this machine. It is the closest thing DevTools has to "a mid
 * range Android", and 6 is the closest to a bad one.
 *
 *   node tests/e2e/bench-mobile.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-mobile-bench';
const VIEWPORT = { width: 844, height: 390 };
const WARMUP_MS = 2_500;
const SAMPLE_MS = 7_000;

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?touch=1`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: VIEWPORT,
  hasTouch: true,
  deviceScaleFactor: 3,
});
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const cdp = await page.context().newCDPSession(page);
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

await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.touchControls, null, {
  timeout: 30_000,
});
await page.waitForTimeout(2_000);

const report = { viewport: VIEWPORT };

report.buffers = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const fogCanvas = game.fogOfWar.overlay.drawingContext.canvas;
  // By class, not by tag: stats.js puts three of its own canvases inside
  // #game-scene, and they come first in document order.
  const main = document.querySelector('#game-scene canvas.p5Canvas');
  return {
    devicePixelRatio: window.devicePixelRatio,
    sketchDensity: window.pixelDensity(),
    fogOverlayDensity: game.fogOfWar.overlay.pixelDensity(),
    fogCss: `${game.fogOfWar.overlay.width}x${game.fogOfWar.overlay.height}`,
    fogBacking: `${fogCanvas.width}x${fogCanvas.height}`,
    fogMegapixels: Math.round((fogCanvas.width * fogCanvas.height) / 1e4) / 100,
    mainBacking: main ? `${main.width}x${main.height}` : null,
  };
});

// One set of wrappers, installed once, reset between passes. Each records the
// wall time of one system per call, the way bench-pathfinding does.
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const state = {
    update: [],
    draw: [],
    fog: [],
    nav: [],
    objects: [],
    terrain: [],
    touchUpdate: [],
    touchDraw: [],
    hud: [],
    fps: [],
  };
  window.__mobileBench = state;

  const wrap = (owner, method, bucket) => {
    const original = owner[method].bind(owner);
    owner[method] = (...args) => {
      const start = performance.now();
      const result = original(...args);
      bucket.push(performance.now() - start);
      return result;
    };
  };

  wrap(game, 'update', state.update);
  wrap(game, 'draw', state.draw);
  wrap(game.fogOfWar, 'draw', state.fog);
  wrap(game.navigation, 'update', state.nav);
  wrap(game.objectManager, 'update', state.objects);
  wrap(game.terrainMap, 'update', state.terrain);
  wrap(game.touchControls, 'update', state.touchUpdate);
  wrap(game.touchControls, 'draw', state.touchDraw);
  wrap(game.inGameHUD, 'update', state.hud);

  setInterval(() => state.fps.push(window.frameRate()), 100);
});

const summarise = `(values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const round = n => Math.round(n * 1000) / 1000;
  return {
    n: sorted.length,
    mean: round(sorted.reduce((t, v) => t + v, 0) / sorted.length),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}`;

async function pass({ rate, label, holdTouch }) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  if (holdTouch) {
    const points = await page.evaluate(() => {
      const layout = window.__lol2d.scene.oScene.game.touchControls.currentLayout;
      const q = layout.buttons.find(b => b.slot === 1);
      return {
        stick: { x: layout.joystickHome.x, y: layout.joystickHome.y },
        button: { x: q.x, y: q.y },
      };
    });
    // A thumb on the stick, pushed off centre — the champion is walking, the
    // fog is recomputing every frame and the controls are drawing live.
    await dispatch('touchStart', [{ id: 0, x: points.stick.x, y: points.stick.y }]);
    await dispatch('touchMove', [{ id: 0, x: points.stick.x + 55, y: points.stick.y - 30 }]);
  }
  await page.waitForTimeout(WARMUP_MS);
  await page.evaluate(() => {
    for (const bucket of Object.values(window.__mobileBench)) bucket.length = 0;
  });
  await page.waitForTimeout(SAMPLE_MS);

  const result = await page.evaluate(fn => {
    const summarise = eval(fn);
    const state = window.__mobileBench;
    const game = window.__lol2d.scene.oScene.game;
    return {
      objects: game.objectManager.objects.length,
      fps: summarise(state.fps),
      update: summarise(state.update),
      draw: summarise(state.draw),
      fog: summarise(state.fog),
      nav: summarise(state.nav),
      objectManager: summarise(state.objects),
      terrain: summarise(state.terrain),
      touchUpdate: summarise(state.touchUpdate),
      touchDraw: summarise(state.touchDraw),
      hud: summarise(state.hud),
    };
  }, summarise);

  if (holdTouch) await dispatch('touchEnd', []);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  report[label] = result;

  // The number that decides whether the game holds 60: one update plus one
  // draw against the 16.67ms a frame has.
  result.frameP95Ms = Math.round(((result.update?.p95 ?? 0) + (result.draw?.p95 ?? 0)) * 100) / 100;
  result.budgetUsedPercent = Math.round((result.frameP95Ms / 16.67) * 100);

  const cell = (value, width = 6) => String(value ?? '-').padStart(width);
  console.log(
    `${label.padEnd(24)} obj ${cell(result.objects, 3)}  fps ${cell(Math.round(result.fps.mean), 3)}  ` +
      `update ${cell(result.update?.p95)}  draw ${cell(result.draw?.p95)}  ` +
      `fog ${cell(result.fog?.p95)}  nav ${cell(result.nav?.p95)}  ` +
      `touch ${cell(
        Math.round(((result.touchUpdate?.p95 ?? 0) + (result.touchDraw?.p95 ?? 0)) * 1000) / 1000
      )}  hud ${cell(result.hud?.p95)}  ` +
      `frame p95 ${cell(result.frameP95Ms)}ms = ${result.budgetUsedPercent}% of budget`
  );
  return result;
}

console.log(`\nphone viewport ${VIEWPORT.width}x${VIEWPORT.height}, dPR ${report.buffers.devicePixelRatio}\n`);

console.log(
  'columns: p95 milliseconds per call, except fps (mean) and objects (count)\n'
);

await pass({ rate: 1, label: 'throttle-1x-idle' });
await pass({ rate: 4, label: 'throttle-4x-idle' });
await pass({ rate: 4, label: 'throttle-4x-thumb-down', holdTouch: true });
await pass({ rate: 6, label: 'throttle-6x-idle' });
await pass({ rate: 6, label: 'throttle-6x-thumb-down', holdTouch: true });
// Past any real phone, to find where it actually breaks rather than reporting
// "it was fine" at the two rates that happened to be asked for.
await pass({ rate: 10, label: 'throttle-10x-thumb-down', holdTouch: true });
await pass({ rate: 20, label: 'throttle-20x-thumb-down', holdTouch: true });

// What the fog would cost if its buffer followed the device pixel ratio
// instead of being pinned to 1. Same frame, same scene, one property changed.
console.log('\nfog overlay density A/B at 6x throttle:');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
report.fogDensityAB = {};
for (const density of [1, 3, 1]) {
  await page.evaluate(d => {
    const fog = window.__lol2d.scene.oScene.game.fogOfWar;
    fog.overlay.pixelDensity(d);
    window.__mobileBench.fog.length = 0;
  }, density);
  await page.waitForTimeout(1_500);
  await page.evaluate(() => {
    window.__mobileBench.fog.length = 0;
  });
  await page.waitForTimeout(3_500);
  const result = await page.evaluate(
    fn => {
      const summarise = eval(fn);
      const fog = window.__lol2d.scene.oScene.game.fogOfWar;
      const canvas = fog.overlay.drawingContext.canvas;
      return {
        backing: `${canvas.width}x${canvas.height}`,
        megapixels: Math.round((canvas.width * canvas.height) / 1e4) / 100,
        draw: summarise(window.__mobileBench.fog),
      };
    },
    summarise
  );
  report.fogDensityAB[`density-${density}`] = result;
  console.log(
    `  density ${density}: ${result.backing} (${result.megapixels}MP)  draw mean ${result.draw.mean}ms  p95 ${result.draw.p95}ms  max ${result.draw.max}ms`
  );
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

await page.screenshot({ path: `${OUT}-frame.png` });

console.log('\n--- report ---');
console.log(JSON.stringify(report, null, 2));
if (errors.length) {
  console.log('\n--- page errors ---');
  for (const error of errors.slice(0, 10)) console.log(error);
}

await browser.close();
await server.close();
