/**
 * One bad frame must not be the last one.
 *
 * p5's `_draw` calls into the game and only *afterwards* re-arms
 * `requestAnimationFrame` (`p5.js:66431` and `:66449`), so before
 * `RenderGuard.ts` a single throw anywhere in draw ended the session: black
 * canvas, live Vue HUD, nothing but a reload to fix it. Reported from an
 * installed PWA after the app had been backgrounded a while, and the player is
 * on a phone with no console to look at.
 *
 * Vitest can prove the wrapper does not rethrow. What it cannot see is the part
 * that actually failed — p5's own frame chain, in a real browser, still running
 * after the game threw. So this makes the live scene throw and then counts
 * frames.
 *
 *   node tests/e2e/verify-render-guard.mjs
 */
import { startHarness } from './harness.mjs';

const { url, page, report, check, errors, guard } = await startHarness();

/** How many frames p5 has drawn. `frameCount` is a p5 global in this project. */
const frames = () => page.evaluate(() => window.frameCount ?? 0);
const settle = ms => page.waitForTimeout(ms);

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await settle(600);

  // 1. The loop is running to begin with, or nothing below means anything.
  const before = await frames();
  await settle(500);
  const running = await frames();
  check('the frame loop is running', running > before, `${before} -> ${running}`);

  // 2. Break it. The scene's own draw is inside `SceneManager.draw()`, which is
  //    what the guard wraps — the same place a real crash would come from.
  await page.evaluate(() => {
    const scene = window.__lol2d.scene.oScene;
    window.__realDraw = scene.draw.bind(scene);
    scene.draw = () => {
      throw new Error('e2e-forced-draw-crash');
    };
  });
  await settle(800);

  const duringCrash = await frames();
  check(
    'the loop survives a draw that throws every frame',
    duringCrash > running + 5,
    `${running} -> ${duringCrash}`
  );

  // 3. And the player, who cannot open a console, is told.
  report.overlay = await page.evaluate(() => {
    const box = document.getElementById('render-crash');
    if (!box) return null;
    return {
      text: box.textContent?.slice(0, 120) ?? '',
      hasReload: Boolean([...box.querySelectorAll('button')].some(b => b.textContent?.trim())),
      counted: Number(box.querySelector('[data-crash-count]')?.textContent ?? 0),
    };
  });
  check('the crash is put on the screen', report.overlay !== null);
  check('it names the error', (report.overlay?.text ?? '').includes('e2e-forced-draw-crash'));
  check('it offers a reload', report.overlay?.hasReload === true);
  check(
    'it counts the frames that failed',
    (report.overlay?.counted ?? 0) > 1,
    `${report.overlay?.counted}`
  );

  // 4. Put it back: a recovered draw goes straight on drawing, because the
  //    chain was never broken in the first place.
  await page.evaluate(() => {
    window.__lol2d.scene.oScene.draw = window.__realDraw;
  });
  await settle(500);
  const recovered = await frames();
  check('drawing resumes once the fault clears', recovered > duringCrash, `${recovered}`);

  report.frames = { before, running, duringCrash, recovered };

  // The guard re-throws the first error out of band on purpose, so a crash in
  // draw is still visible to `pageerror` and no Playwright driver goes blind to
  // one. Exactly one, however many frames threw.
  const forced = errors.filter(entry => entry.includes('e2e-forced-draw-crash'));
  report.pageErrors = { forced: forced.length, other: errors.length - forced.length };
  check('the error still reaches pageerror, once', forced.length === 1, `${forced.length}`);
  check('nothing else went wrong', errors.length === forced.length, errors.join(' | '));
});
