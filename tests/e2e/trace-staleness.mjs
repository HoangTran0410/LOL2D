/**
 * One-off diagnostic (not part of the shipped test suite): proves, directly
 * and without the confound of camera/terrain motion in a screenshot diff,
 * whether the player's sight polygon is being recomputed every frame it
 * moves, or is going stale between throttle windows. Works unmodified
 * against both the old (throttled) and new (segment-cached) FogOfWar since
 * both expose the same getSightPoly(obj) method with the same cache
 * semantics (same array reference back == no recompute happened).
 */
import { chromium } from 'playwright';

const URL = process.env.LOL2D_URL ?? 'http://localhost:5320/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(
  () => window.__lol2d?.scene?.oScene?.game?.objectManager,
  null,
  { timeout: 30_000 }
);
await page.waitForTimeout(1_500);

const result = await page.evaluate(() => new Promise(resolve => {
  const game = window.__lol2d.scene.oScene.game;
  const fog = game.fogOfWar;
  const player = game.player;

  player.teleportTo(3200, 3200);
  player.moveTo(3200 + 2600, 3200 + 900);

  const samples = [];
  let lastPoly = null;
  let frames = 0;
  const maxFrames = 60; // 1 second at 60fps

  function tick() {
    const poly = fog.getSightPoly(player);
    const changed = poly !== lastPoly;
    samples.push({
      frame: frames,
      t: performance.now(),
      x: player.position.x,
      y: player.position.y,
      recomputed: changed,
    });
    lastPoly = poly;
    frames += 1;
    if (frames < maxFrames) requestAnimationFrame(tick);
    else resolve(samples);
  }
  requestAnimationFrame(tick);
}));

const recomputedFrames = result.filter(s => s.recomputed).length;
const runs = [];
let run = 0;
for (const s of result) {
  if (s.recomputed) { if (run > 0) runs.push(run); run = 0; }
  run += 1;
}
runs.push(run);

// The decisive check: frame-accuracy means the polygon is never drawn stale
// while the unit has actually moved on since the last frame. staleWhileMoving
// is authoritative for that. recomputeTracksPositionChangeRate is a looser,
// two-way signal (also expects "no move -> no recompute") that won't hit
// exactly 1.0 even for a fully frame-accurate implementation, because a
// recompute can legitimately fire for a reason this probe doesn't sample
// (e.g. visionRadius) without x/y moving — it's reported for context, not as
// the pass/fail bar.
let matches = 0;
let staleWhileMoving = 0;
for (let i = 1; i < result.length; i++) {
  const positionChanged = result[i].x !== result[i - 1].x || result[i].y !== result[i - 1].y;
  if (positionChanged === result[i].recomputed) matches += 1;
  if (positionChanged && !result[i].recomputed) staleWhileMoving += 1;
}

console.log(JSON.stringify({
  totalFrames: result.length,
  recomputedFrames,
  recomputedFraction: recomputedFrames / result.length,
  // consecutive-non-recompute run lengths between recomputes (stale-frame streaks)
  staleRunLengths: runs,
  maxStaleRun: Math.max(...runs),
  // frames where the position moved but the returned polygon did NOT change
  // (i.e. drawn stale relative to where the unit actually is right now)
  staleWhileMovingFrames: staleWhileMoving,
  recomputeTracksPositionChangeRate: matches / (result.length - 1),
  firstTenPositionsAndFlags: result.slice(0, 10).map(s => ({ x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, recomputed: s.recomputed })),
}, null, 2));

await browser.close();
