/**
 * Fog-of-war walking benchmark.
 *
 * Drives the live game in system Chrome (same DEV-only window.__lol2d handle
 * as drive-game.mjs), walks the player continuously for several seconds, and
 * samples frameRate() plus a performance.now() timing wrapped tightly around
 * FogOfWar.draw() every frame. Also grabs a handful of screenshots a fixed
 * number of frames apart while walking, cropped around the player, so the
 * fog edge can be inspected by eye for sliding vs snapping.
 *
 * Usage:
 *   npx vite --port 5320 --strictPort   # in another terminal
 *   node tests/e2e/measure-fog.mjs /tmp/lol2d-fog [seconds]
 *
 * LOL2D_URL overrides the target URL (defaults to http://localhost:5320/).
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-fog';
const SECONDS = Number(process.argv[3] ?? 6);
const URL = process.env.LOL2D_URL ?? 'http://localhost:5320/';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(
  () => window.__lol2d?.scene?.oScene?.game?.objectManager,
  null,
  { timeout: 30_000 }
);
await page.waitForTimeout(1_500);

// Instrument FogOfWar.draw() with a tight performance.now() wrapper and walk
// the player continuously and unobstructed: teleport to a spot with no walls
// in vision range (found by scanning terrainMap.obstacles — deterministic,
// same on every run since the map is static, so before/after comparisons
// walk the exact same ground regardless of the random fountain spawn point)
// and comfortably inside the map bounds, then issue one long, straight
// moveTo so movement never stalls against a wall or the map edge for the
// whole sampling window — this is the everyday "walking across the map"
// case the player reported judder in, not a worst-case obstacle maze.
const startInfo = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const fog = game.fogOfWar;
  const player = game.player;
  const mapSize = game.mapSize;
  const walls = game.terrainMap.obstacles.filter(o => o.type === 'wall');
  const margin = 900;

  let open = null;
  for (let x = margin; x <= mapSize - margin && !open; x += 400) {
    for (let y = margin; y <= mapSize - margin; y += 400) {
      const blocked = walls.some(w => {
        const bb = w.getBoundingBox();
        const cx = bb.x + bb.w / 2;
        const cy = bb.y + bb.h / 2;
        return Math.hypot(cx - x, cy - y) < 700;
      });
      if (!blocked) { open = { x, y }; break; }
    }
  }
  if (!open) open = { x: mapSize / 2, y: mapSize / 2 };

  player.teleportTo(open.x, open.y);
  // Long, straight walk that stays inside the map for the whole run.
  const dest = { x: Math.min(mapSize - margin, open.x + 2600), y: open.y + 900 };
  player.moveTo(dest.x, dest.y);

  window.__fogTimings = [];
  window.__frameSamples = [];

  const originalDraw = fog.draw.bind(fog);
  fog.draw = function instrumentedDraw() {
    const t0 = performance.now();
    originalDraw();
    window.__fogTimings.push(performance.now() - t0);
  };

  window.__walkInterval = setInterval(() => {
    window.__frameSamples.push({ t: performance.now(), fps: window.frameRate(), x: player.position.x, y: player.position.y });
  }, 200);

  return { open, dest };
});

// Screenshots a fixed number of frames apart while walking, cropped around
// the player's screen position, to eyeball fog-edge sliding vs snapping. The
// old throttle recomputed every ~100ms, so this burst is spaced to straddle
// one throttle window (0-180ms): under the throttle, the polygon should hold
// still (reprojected through a moving camera) then jump once past 100ms;
// under the new per-frame sweep, it should instead move a little every shot.
const shotRegion = { x: 1280 / 2 - 220, y: 800 / 2 - 220, width: 440, height: 440 };
const shotDelaysMs = [0, 30, 60, 90, 120, 150, 180];
for (let i = 0; i < shotDelaysMs.length; i++) {
  if (i > 0) await page.waitForTimeout(shotDelaysMs[i] - shotDelaysMs[i - 1]);
  await page.screenshot({ path: `${OUT}-walk-${i}.png`, clip: shotRegion });
}

await page.waitForTimeout(Math.max(0, SECONDS * 1000 - shotDelaysMs[shotDelaysMs.length - 1]));

const result = await page.evaluate(() => {
  clearInterval(window.__walkInterval);
  const game = window.__lol2d.scene.oScene.game;
  const timings = window.__fogTimings.slice();
  const frames = window.__frameSamples.slice();
  const sorted = [...timings].sort((a, b) => a - b);
  const sum = timings.reduce((a, b) => a + b, 0);
  const avgFps = frames.length ? frames.reduce((a, s) => a + s.fps, 0) / frames.length : null;
  let distanceWalked = 0;
  for (let i = 1; i < frames.length; i++) {
    distanceWalked += Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y);
  }
  return {
    frameCount: timings.length,
    fogDrawMsAvg: timings.length ? sum / timings.length : null,
    fogDrawMsP50: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null,
    fogDrawMsP95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
    fogDrawMsMax: sorted.length ? sorted[sorted.length - 1] : null,
    avgFrameRate: avgFps,
    distanceWalked,
    finalPlayerPos: { x: game.player.position.x, y: game.player.position.y },
  };
});

console.log(JSON.stringify({ ...result, startInfo, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
