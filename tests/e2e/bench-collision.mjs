/**
 * Frame-budget benchmark for unit body separation.
 *
 * Boots its own Vite dev server on a free port, drives the real game in system
 * Chrome, drops two waves of units on an open patch of map and walks them into
 * each other head-on, then samples the frame rate and the update-tick cost with
 * separation switched off and on.
 *
 * The A/B runs the same build twice and only flips
 * `objectManager.unitCollision.enabled` between them, so nothing but the pass
 * itself differs between the two numbers.
 *
 *   npm run e2e:collision                  # 48 units per the default
 *   npm run e2e:collision -- /tmp/lol2d 64 # screenshot prefix, unit count
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-collision';
const UNIT_COUNT = Number(process.argv[3] ?? 48);
const SAMPLE_MS = 8_000;
const WARMUP_MS = 2_500;

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_500);

/** Spawn the two waves and park the camera on where they will meet. */
const board = await page.evaluate(async unitCount => {
  const { Circle } = await import('/src/libs/quadtree.ts');
  const dummy = await import('/src/game/gameObject/attackableUnits/DummyChampion.ts');
  const preset = await import('/src/game/preset.ts');
  const game = window.__lol2d.scene.oScene.game;

  // Find an open patch: a lane fight inside a wall would measure the terrain
  // push-out fighting the separation rather than the separation.
  let centre = null;
  for (let x = 800; x <= game.mapSize - 800 && !centre; x += 200) {
    for (let y = 800; y <= game.mapSize - 800 && !centre; y += 200) {
      const walls = game.terrainMap.getObstaclesInArea(new Circle({ x, y, r: 520 }), ['wall']);
      if (walls.length === 0) centre = { x, y };
    }
  }
  if (!centre) centre = { x: game.mapSize / 2, y: game.mapSize / 2 };

  // Two visible teams rather than the per-unit uuid teams the game hands out:
  // fog of war would otherwise hide the whole fight, which both spoils the
  // screenshots and measures a frame that never draws the crowd.
  const enemyTeam = 'bench-enemy-team';
  const lanes = 8;
  const perWave = Math.floor(unitCount / 2);
  const spawned = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < perWave; i++) {
      const row = Math.floor(i / lanes);
      const lane = i % lanes;
      const laneY = centre.y - ((lanes - 1) / 2) * 62 + lane * 62;
      const unit = new dummy.default({
        game,
        position: window.createVector(centre.x + side * (300 + row * 62), laneY),
        preset: preset.getChampionPresetRandom(),
      });
      unit.setTeamId(side < 0 ? game.player.teamId : enemyTeam);
      unit.stats.speed.baseValue = 2.4;
      game.objectManager.addObject(unit);
      spawned.push({ unit, side, laneY });
    }
  }

  // The player watches from the side rather than standing in the pile.
  game.player.teleportTo(centre.x, centre.y - 460);
  game.player.moveTo(centre.x, centre.y - 460);
  game.camera.target = window.createVector(centre.x, centre.y);
  game.camera.scale = 1;
  game.camera.currentScale = 1;

  // Each wave is told to stand where the other one is, so they press into each
  // other for the whole run instead of walking through and stopping on the far
  // side. This is the head-on meeting the pass has to hold apart.
  window.__benchDrive = setInterval(() => {
    for (const { unit, side, laneY } of spawned) {
      unit.moveTo(centre.x - side * 40, laneY);
    }
  }, 400);

  window.__benchWaves = spawned;
  window.__benchCentre = centre;
  return { centre, spawned: spawned.length, objects: game.objectManager.objects.length };
}, UNIT_COUNT);

/** Time one configuration end to end. */
async function measure(enabled) {
  await page.evaluate(on => {
    const game = window.__lol2d.scene.oScene.game;
    game.objectManager.unitCollision.enabled = on;

    // reinstall the probes fresh each run so the two samples never share data
    if (window.__benchRestore) window.__benchRestore();
    const originalUpdate = game.update.bind(game);
    const collision = game.objectManager.unitCollision;
    const originalResolve = collision.resolve.bind(collision);

    const state = { update: [], separation: [], fps: [] };
    window.__bench = state;

    game.update = function benchUpdate() {
      const start = performance.now();
      originalUpdate();
      state.update.push(performance.now() - start);
    };
    collision.resolve = function benchResolve(objects) {
      const start = performance.now();
      originalResolve(objects);
      state.separation.push(performance.now() - start);
    };
    const fpsTimer = setInterval(() => state.fps.push(window.frameRate()), 100);

    window.__benchRestore = () => {
      clearInterval(fpsTimer);
      delete game.update;
      delete collision.resolve;
      window.__benchRestore = null;
    };
  }, enabled);

  await page.waitForTimeout(WARMUP_MS);
  await page.evaluate(() => {
    window.__bench.update.length = 0;
    window.__bench.separation.length = 0;
    window.__bench.fps.length = 0;
  });
  await page.waitForTimeout(SAMPLE_MS);

  return page.evaluate(() => {
    const summarise = values => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const round = n => Math.round(n * 1000) / 1000;
      // Chrome coarsens performance.now() to 100µs, so a single sub-millisecond
      // sample is quantised. The mean over a few hundred of them is not.
      const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
      return {
        samples: sorted.length,
        min: round(sorted[0]),
        mean: round(mean),
        median: round(at(0.5)),
        p95: round(at(0.95)),
        max: round(sorted[sorted.length - 1]),
      };
    };
    const state = window.__bench;
    return {
      fps: summarise(state.fps),
      updateMs: summarise(state.update),
      separationMs: summarise(state.separation),
      bodies: window.__lol2d.scene.oScene.game.objectManager.unitCollision.bodyCount,
      units: window.__lol2d.scene.oScene.game.objectManager.objects.length,
    };
  });
}

const before = await measure(false);
const after = await measure(true);

await page.evaluate(() => {
  if (window.__benchRestore) window.__benchRestore();
});

for (const [enabled, suffix] of [
  [false, 'pile'],
  [true, 'line'],
]) {
  await page.evaluate(on => {
    window.__lol2d.scene.oScene.game.objectManager.unitCollision.enabled = on;
  }, enabled);
  await page.waitForTimeout(4_000);
  await page.screenshot({ path: `${OUT}-${suffix}.png` });
}

await page.evaluate(() => clearInterval(window.__benchDrive));

console.log(JSON.stringify({ board, unitCount: UNIT_COUNT, before, after, errors }, null, 2));

await browser.close();
await server.close();
if (errors.length) process.exitCode = 1;
