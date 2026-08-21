/**
 * Does render interpolation even out the drawn step?
 *
 * The simulation advances on `GameScene.updateLoop`'s own `setTimeout` at a
 * fixed `Game.fps` of 60, while p5's `draw()` runs throttled to the render
 * preference. Nothing synchronises them, so a rendered frame catches the
 * simulation at whatever phase it happens to: a body moving an even 3px per tick
 * gets *drawn* moving a different number of whole ticks each frame. That is the
 * jiggle, and it is a phase problem — the simulation speed is perfectly steady.
 *
 * To measure it deterministically this pins the render loop *below* the sim rate
 * — `frameRate(40)` against the 60Hz sim, the very "một render thường = 1-2 sim"
 * the design was asked to fix. The two rates beat against each other 2:3, so a
 * rendered frame catches one tick or two in strict alternation while the
 * champion walks at a dead-constant speed. That is faithful to the real defect
 * (a slow phone throttling its own draw) and, unlike disturbing the loop with
 * blocking, it does not slow the simulation itself — so the drawn step is the
 * only thing under test.
 *
 * One walk, two passes:
 *   - **baseline** forces `alpha = 1` — the shipped, un-interpolated draw. Its
 *     step must still lurch, or the probe proves nothing.
 *   - **interp** uses the real alpha the scene computes. The step must even out.
 *
 * The position sampled is the one the renderer actually used: `player.draw` is
 * wrapped, so the read lands *after* `ObjectManager.draw` has substituted the
 * blended position, not before.
 *
 *   node tests/e2e/measure-frame-pacing.mjs
 */
import { startHarness } from './harness.mjs';

const { url, page, check, report, guard } = await startHarness({});

/** Coefficient of variation of the per-frame drawn step, over one pass. */
function stepStats(frames) {
  // Drop the first few: the order has just been issued.
  const used = frames.slice(5);
  const distances = [];
  const tickCounts = {};
  for (let i = 1; i < used.length; i++) {
    const ms = used[i].t - used[i - 1].t;
    tickCounts[used[i].ticks] = (tickCounts[used[i].ticks] ?? 0) + 1;
    if (ms > 0 && ms < 100) {
      distances.push(Math.hypot(used[i].x - used[i - 1].x, used[i].y - used[i - 1].y));
    }
  }
  const n = distances.length || 1;
  const mean = distances.reduce((sum, d) => sum + d, 0) / n;
  const spread = Math.sqrt(distances.reduce((sum, d) => sum + (d - mean) ** 2, 0) / n);
  return {
    measured: distances.length,
    mean: Number(mean.toFixed(3)),
    stdDev: Number(spread.toFixed(3)),
    cv: Number((spread / (mean || 1)).toFixed(3)),
    min: Number(Math.min(...distances).toFixed(3)),
    max: Number(Math.max(...distances).toFixed(3)),
    simTicksPerRenderedFrame: tickCounts,
  };
}

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const { baseline, interp } = await page.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;

    // Render below the 60Hz sim, so a frame catches one tick or two in a steady
    // 2:3 beat — a drifting render phase over a constant sim speed. `alpha` is
    // still measured against the sim step (`game.fps`), not this rate.
    frameRate(40);

    let ticks = 0;
    const originalUpdate = game.update.bind(game);
    game.update = function () {
      originalUpdate();
      ticks++;
    };

    // The position the renderer used: read inside player.draw, after the draw
    // pass has substituted the interpolated position.
    let drawnX = 0;
    let drawnY = 0;
    const originalPlayerDraw = player.draw.bind(player);
    player.draw = function (...args) {
      drawnX = player.position.x;
      drawnY = player.position.y;
      return originalPlayerDraw(...args);
    };

    let forceNoInterp = false;
    let sink = null;
    const originalDraw = game.draw.bind(game);
    game.draw = function (alpha) {
      // forceNoInterp collapses to alpha 1 — the un-interpolated control.
      originalDraw(forceNoInterp ? 1 : alpha);
      if (sink) sink.push({ t: performance.now(), x: drawnX, y: drawnY, ticks });
      ticks = 0;
    };

    const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Walk a long straight line away from spawn, ignoring routes so terrain
    // cannot turn the champion mid-measurement.
    player.moveTo(player.position.x + 4000, player.position.y);
    await settle(600);

    // Control first: interpolation forced off must still lurch.
    const baseline = [];
    forceNoInterp = true;
    sink = baseline;
    await settle(2_500);

    // Then the real path.
    const interp = [];
    forceNoInterp = false;
    sink = interp;
    await settle(2_500);

    sink = null;
    game.update = originalUpdate;
    game.draw = originalDraw;
    player.draw = originalPlayerDraw;
    return { baseline, interp };
  });

  const baselineStats = stepStats(baseline);
  const interpStats = stepStats(interp);
  report.baseline = baselineStats;
  report.interpolated = interpStats;

  check(
    'the champion actually moved',
    interpStats.mean > 0.5,
    `mean drawn step ${interpStats.mean}px`
  );
  check(
    'interpolation off still lurches between whole ticks — the probe is falsifiable',
    baselineStats.cv > 0.2,
    `baseline cv ${baselineStats.cv} (min ${baselineStats.min}px, max ${baselineStats.max}px, ticks ${JSON.stringify(baselineStats.simTicksPerRenderedFrame)})`
  );
  check(
    'interpolation evens the drawn step (coefficient of variation under 0.15)',
    interpStats.cv < 0.15,
    `interp cv ${interpStats.cv} (min ${interpStats.min}px, max ${interpStats.max}px)`
  );
});
