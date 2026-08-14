/**
 * End-to-end drive of the mobile HUD's touch reachability — the thing the
 * owner actually reported broken: "bấm hud ko hiện modal" (tapping the HUD
 * does not show the modal).
 *
 * The root cause: `GameScene`'s p5 touch handlers call `preventDefault()` on
 * every touch on the page (needed so a drag across the *canvas* does not
 * scroll or pinch-zoom it), and a browser that has had `preventDefault()`
 * called anywhere in a touch gesture will not synthesise the trailing
 * `click` for that gesture — not just on the canvas, on the DOM HUD sitting
 * on top of it too. So this drives everything with *real* CDP touch events,
 * never a synthetic click and never a direct method call on the Vue
 * instance — a script that called `hud.changeSpell()` directly would pass
 * even with the underlying bug still in place, which is exactly how the bug
 * shipped the first time.
 *
 *   node tests/e2e/drive-mobile-hud.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-mobile-hud';
const VIEWPORT = { width: 844, height: 390 };

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?touch=1`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: VIEWPORT,
  hasTouch: true,
  // A retina phone. A previous HUD bug (a badge overlapping the
  // neighbouring icon's hotkey) was invisible at 1x and only showed up here.
  deviceScaleFactor: 3,
});
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const cdp = await page.context().newCDPSession(page);
const report = {};
const failures = [];
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

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

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.touchControls, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // ---------------------------------------------------- 1. real tap opens it

  const iconBox = await page.evaluate(() => {
    const icon = document.querySelectorAll('.bottom-HUD .spell')[1];
    const box = icon.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });

  const pickerBeforeTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker
  );
  await tap(iconBox.x, iconBox.y);
  await page.waitForTimeout(300);
  report.pickerAfterRealTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker
  );
  check(
    'a real touch tap on the strip opens the spell picker',
    pickerBeforeTap === false && report.pickerAfterRealTap === true,
    `before ${pickerBeforeTap}, after ${report.pickerAfterRealTap}`
  );
  await page.screenshot({ path: `${OUT}-01-picker-open.png` });

  // ------------------------------------------- 2. picking one under a thumb

  const beforePick = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[1]?.constructor.name
  );
  // Shaco is in the roster (see the desktop picker screenshot); his kit is
  // distinct from whatever the random preset gave the player, so a real
  // change is unambiguous.
  const shacoIcon = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.spell-picker .group')];
    const shaco = groups.find(g => g.querySelector('.group-header p')?.textContent?.trim() === 'Shaco');
    const icon = shaco?.querySelectorAll('.spell')[0];
    if (!icon) return null;
    const box = icon.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  check('the Shaco group is present and tappable', shacoIcon !== null);
  if (shacoIcon) {
    await tap(shacoIcon.x, shacoIcon.y);
    await page.waitForTimeout(250);
  }
  const afterPick = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[1]?.constructor.name
  );
  report.pick = { beforePick, afterPick };
  check(
    'a real touch tap on a picker entry equips it',
    afterPick !== beforePick && afterPick?.startsWith('Shaco'),
    `${beforePick} -> ${afterPick}`
  );
  // pick() closes the picker itself; reopen for the rest of the checks.
  await page.evaluate(() => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.changeSpell(1));
  await page.waitForTimeout(300);

  // --------------------------------------------------- 3. checkboxes toggle

  const checkboxBox = await page.evaluate(() => {
    const box = document.querySelector('#oneForAll').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const before1ForAll = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.oneForAll
  );
  await tap(checkboxBox.x, checkboxBox.y, 40);
  await page.waitForTimeout(150);
  const after1ForAll = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.oneForAll
  );
  check(
    'a real tap on the "ONE spell for ALL" checkbox toggles it',
    before1ForAll === false && after1ForAll === true,
    `${before1ForAll} -> ${after1ForAll}`
  );

  // ----------------------------------------------------------- 4. scrolling

  const scrollBefore = await page.evaluate(() => document.querySelector('.spell-picker').scrollTop);
  const pickerBox = await page.evaluate(() => {
    const box = document.querySelector('.spell-picker').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height * 0.7 };
  });
  await touchStart([{ x: pickerBox.x, y: pickerBox.y }]);
  await touchMove([{ x: pickerBox.x, y: pickerBox.y - 150 }]);
  await page.waitForTimeout(80);
  await touchMove([{ x: pickerBox.x, y: pickerBox.y - 260 }]);
  await page.waitForTimeout(120);
  const scrollDuring = await page.evaluate(() => document.querySelector('.spell-picker').scrollTop);
  await touchEnd();
  await page.waitForTimeout(150);
  report.scroll = { scrollBefore, scrollDuring };
  check(
    'a touch drag inside the picker scrolls it (native scroll is suppressed page-wide, so this is hand-rolled)',
    scrollDuring > scrollBefore + 20,
    `scrollTop ${scrollBefore} -> ${scrollDuring}`
  );

  // ------------------------------- 5. a drag that starts on an icon scrolls,
  //                                    it does not also pick that icon

  const beforeDragPick = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[1]?.constructor.name
  );
  const firstVisibleIcon = await page.evaluate(() => {
    const icon = document.querySelector('.spell-picker .group .spell');
    const box = icon.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await touchStart([{ x: firstVisibleIcon.x, y: firstVisibleIcon.y }]);
  await touchMove([{ x: firstVisibleIcon.x, y: firstVisibleIcon.y - 120 }]);
  await page.waitForTimeout(80);
  await touchMove([{ x: firstVisibleIcon.x, y: firstVisibleIcon.y - 220 }]);
  await page.waitForTimeout(100);
  await touchEnd();
  await page.waitForTimeout(200);
  const afterDragPick = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[1]?.constructor.name
  );
  check(
    'a drag that starts on a picker icon (scrolling) does not equip it',
    afterDragPick === beforeDragPick,
    `${beforeDragPick} -> ${afterDragPick}`
  );

  // ---------------------------------------------------------- 6. close button

  const closeBox = await page.evaluate(() => {
    const box = document.querySelector('.spell-picker .close-btn').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
  });
  check(
    'the close button is at least the 44px thumb target',
    closeBox.w >= 44 && closeBox.h >= 44,
    `${closeBox.w}x${closeBox.h}`
  );
  await tap(closeBox.x, closeBox.y, 40);
  await page.waitForTimeout(250);
  report.pickerAfterClose = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker
  );
  check('a real touch tap on the close button closes the picker', report.pickerAfterClose === false);

  // --------------------------------------------- 7. high-DPI overlap check

  report.badgeOverlap = await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.bottom-HUD .spell')];
    const overlaps = [];
    for (let i = 0; i < icons.length - 1; i++) {
      const a = icons[i].querySelector('.edit-badge')?.getBoundingClientRect();
      const b = icons[i + 1].getBoundingClientRect();
      if (a && a.right > b.left + 2) {
        overlaps.push({ i, badgeRight: a.right, nextLeft: b.left });
      }
    }
    return overlaps;
  });
  check(
    'no icon\'s edit badge overlaps the next icon (checked at 3x device scale)',
    report.badgeOverlap.length === 0,
    JSON.stringify(report.badgeOverlap)
  );
  await page.screenshot({ path: `${OUT}-02-strip-zoom.png`, clip: { x: 0, y: 0, width: 260, height: 60 } });
} catch (error) {
  failures.push(`threw: ${error.stack ?? error}`);
} finally {
  console.log('\n--- report ---');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) {
    console.log('\n--- page errors ---');
    for (const error of errors.slice(0, 10)) console.log(error);
  }
  console.log(`\nscreenshots: ${OUT}-*.png`);
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
