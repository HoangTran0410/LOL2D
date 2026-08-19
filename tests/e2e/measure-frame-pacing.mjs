/**
 * Is the jiggle a phase problem between two clocks?
 *
 * `GameScene.updateLoop` advances the simulation on its own `setTimeout` loop
 * at a fixed `Game.fps` of 60, while p5's `draw()` runs on requestAnimationFrame
 * throttled to the render preference. Nothing synchronises them, so a rendered
 * frame samples the simulation at whatever phase it happens to catch. A body
 * that moves an even 3px per tick would then be *drawn* moving 0, 3 or 6px
 * between consecutive frames — which is what a jiggle is.
 *
 * This measures that directly rather than arguing about it: it records the
 * player's world position on every rendered frame and the number of simulation
 * ticks that happened between them.
 *
 *   node tests/e2e/measure-frame-pacing.mjs
 */
import { startHarness } from './harness.mjs';

const { url, page, check, report, finish } = await startHarness({});

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const samples = await page.evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;

    const frames = [];
    let ticks = 0;
    const originalUpdate = game.update.bind(game);
    const originalDraw = game.draw.bind(game);
    game.update = function () {
      const before = player.position.x;
      originalUpdate();
      if (player.position.x !== before) ticks++;
      else ticks++;
    };
    game.draw = function () {
      frames.push({ t: performance.now(), x: player.position.x, y: player.position.y, ticks });
      ticks = 0;
      return originalDraw();
    };

    // Walk a long straight line away from spawn, ignoring routes so terrain
    // cannot turn the champion mid-measurement.
    player.moveTo(player.position.x + 4000, player.position.y);
    await new Promise(resolve => setTimeout(resolve, 2500));

    game.update = originalUpdate;
    game.draw = originalDraw;
    return frames;
  });

  // Drop the first few frames: the order has just been issued.
  const used = samples.slice(5);
  const steps = [];
  for (let i = 1; i < used.length; i++) {
    steps.push({
      moved: Math.hypot(used[i].x - used[i - 1].x, used[i].y - used[i - 1].y),
      ms: used[i].t - used[i - 1].t,
      ticks: used[i].ticks,
    });
  }
  const moving = steps.filter(step => step.ms > 0 && step.ms < 100);
  const distances = moving.map(step => step.moved);
  const mean = distances.reduce((sum, d) => sum + d, 0) / (distances.length || 1);
  const spread = Math.sqrt(
    distances.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (distances.length || 1)
  );
  const tickCounts = {};
  for (const step of moving) tickCounts[step.ticks] = (tickCounts[step.ticks] ?? 0) + 1;

  report.frames = samples.length;
  report.measured = moving.length;
  report.meanStepPx = Number(mean.toFixed(3));
  report.stepStdDevPx = Number(spread.toFixed(3));
  report.stepCoefficientOfVariation = Number((spread / (mean || 1)).toFixed(3));
  report.minStepPx = Number(Math.min(...distances).toFixed(3));
  report.maxStepPx = Number(Math.max(...distances).toFixed(3));
  report.simTicksPerRenderedFrame = tickCounts;

  check('the champion actually moved', mean > 0.5, `mean step ${mean.toFixed(2)}px`);
  check(
    'per-frame step is even (coefficient of variation under 0.15)',
    spread / (mean || 1) < 0.15,
    `cv ${(spread / (mean || 1)).toFixed(3)}, min ${Math.min(...distances).toFixed(2)}px, max ${Math.max(...distances).toFixed(2)}px`
  );
  check(
    'exactly one simulation tick per rendered frame',
    Object.keys(tickCounts).length === 1 && tickCounts['1'] !== undefined,
    JSON.stringify(tickCounts)
  );
} finally {
  await finish();
}
