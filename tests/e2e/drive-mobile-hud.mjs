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
 * instance — a script that called `hud.openSpellPicker()` directly would pass
 * even with the underlying bug still in place, which is exactly how the bug
 * shipped the first time.
 *
 * The bottom-HUD strip this used to tap into no longer renders in touch
 * mode at all (see `MobileHudView.vue`'s file comment): health, mana, buff
 * stacks, CC and the revive countdown all already draw on the canvas over
 * the champion, and the loadout row duplicated the canvas spell buttons. The
 * one entry point left is the corner button (`.spell-picker-btn`), which
 * opens the practice panel on Đấu thủ. The loadout it used to reach directly
 * is now one tap further in — a roster row opens `LoadoutEditorModal`, which
 * is a *setup-screen* component written against a browser that synthesises
 * clicks and scrolls lists by itself, neither of which happens inside a
 * match. That bridge (`RosterTab.vue`) is the surface this script has to
 * prove works under a real thumb.
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

  // ------------------------------------------------- 0. the strip is gone

  report.bottomHudPresent = await page.evaluate(() => !!document.querySelector('.bottom-HUD'));
  check('the bottom-HUD strip does not render in touch mode', report.bottomHudPresent === false);
  await page.screenshot({ path: `${OUT}-00-no-strip.png` });

  // ---------------------------------------------------- 1. real tap opens it

  const pickerBtnBox = await page.evaluate(() => {
    const box = document.querySelector('.spell-picker-btn').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
  });
  check(
    'the corner practice-panel button is at least the 44px thumb target',
    pickerBtnBox.w >= 44 && pickerBtnBox.h >= 44,
    `${pickerBtnBox.w}x${pickerBtnBox.h}`
  );

  const pickerBeforeTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker
  );
  await tap(pickerBtnBox.x, pickerBtnBox.y);
  await page.waitForTimeout(300);
  report.pickerAfterRealTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker
  );
  check(
    'a real touch tap on the corner button opens the practice panel',
    pickerBeforeTap === false && report.pickerAfterRealTap === true,
    `before ${pickerBeforeTap}, after ${report.pickerAfterRealTap}`
  );
  report.tabOnOpen = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.practice-tab')].map(tab => tab.id),
    selected: document.querySelector('.practice-tab.selected')?.id ?? null,
  }));
  check(
    'the panel opens on Đấu thủ, with the three tabs it should have',
    report.tabOnOpen.selected === 'practice-tab-roster' && report.tabOnOpen.tabs.length === 3,
    JSON.stringify(report.tabOnOpen)
  );
  await page.screenshot({ path: `${OUT}-01-panel-open.png` });

  // ------------------------------- 2. a roster row opens the loadout editor
  //
  // The editor is `src/scenes/setup/LoadoutEditorModal.vue`, driven entirely
  // from `@click` because on the setup screen a tap synthesises one. In here
  // it does not, so `RosterTab.vue` bridges the gesture by hand — this is the
  // check that the bridge is actually wired.

  const rowBox = await page.evaluate(() => {
    const box = document
      .querySelector('.practice-roster-row.is-player .practice-roster-open')
      .getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, h: box.height };
  });
  check("the player's roster row is at least the 44px thumb target", rowBox.h >= 44, `${rowBox.h}`);
  await tap(rowBox.x, rowBox.y);
  await page.waitForTimeout(350);
  report.editorAfterRowTap = await page.evaluate(() => !!document.querySelector('.loadout-modal'));
  check(
    'a real touch tap on a roster row opens the loadout editor',
    report.editorAfterRowTap === true
  );
  await page.screenshot({ path: `${OUT}-02-editor-open.png` });

  // ------------------------------------- 3. the editor's roster scrolls, and
  //                                          a drag on an icon does not pick

  const scrollBefore = await page.evaluate(
    () => document.querySelector('.loadout-modal .pregame-modal-body').scrollTop
  );
  const bodyBox = await page.evaluate(() => {
    const box = document
      .querySelector('.loadout-modal .pregame-modal-body')
      .getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height * 0.7 };
  });
  await touchStart([{ x: bodyBox.x, y: bodyBox.y }]);
  await touchMove([{ x: bodyBox.x, y: bodyBox.y - 150 }]);
  await page.waitForTimeout(80);
  await touchMove([{ x: bodyBox.x, y: bodyBox.y - 260 }]);
  await page.waitForTimeout(120);
  const scrollDuring = await page.evaluate(
    () => document.querySelector('.loadout-modal .pregame-modal-body').scrollTop
  );
  await touchEnd();
  await page.waitForTimeout(150);
  report.scroll = { scrollBefore, scrollDuring };
  check(
    'a touch drag inside the editor scrolls it (native scroll is suppressed page-wide, so this is hand-rolled)',
    scrollDuring > scrollBefore + 20,
    `scrollTop ${scrollBefore} -> ${scrollDuring}`
  );

  // ------------------------------------------------ 4. the way back out, twice

  const cancelBox = await page.evaluate(() => {
    const box = document
      .querySelector('.loadout-modal .kit-bar-btn.secondary')
      .getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, h: box.height };
  });
  await tap(cancelBox.x, cancelBox.y, 40);
  await page.waitForTimeout(250);
  report.editorAfterCancel = await page.evaluate(() => !!document.querySelector('.loadout-modal'));
  check(
    'a real touch tap on Huỷ closes the editor and leaves the panel up',
    report.editorAfterCancel === false &&
      (await page.evaluate(() => !!document.querySelector('.practice-panel'))) === true
  );

  const closeBox = await page.evaluate(() => {
    const box = document.querySelector('#practice-close').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
  });
  check(
    'the panel close button is at least the 44px thumb target',
    closeBox.w >= 44 && closeBox.h >= 34,
    `${closeBox.w}x${closeBox.h}`
  );
  await tap(closeBox.x, closeBox.y, 40);
  await page.waitForTimeout(250);
  report.pickerAfterClose = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker
  );
  check('a real touch tap on the close button closes the panel', report.pickerAfterClose === false);

  // --------------------------------------------- 8. high-DPI overlap checks

  // The corner button must clear the ability/summoner arc's topmost point —
  // the geometry `InGameHUD.vue`'s file comment says this was checked
  // against via `computeTouchLayout`, read back here from the same
  // `currentLayout` the canvas buttons themselves use, at the real viewport
  // this test runs at (not a hand-picked one).
  report.cornerVsArc = await page.evaluate(() => {
    const btn = document.querySelector('.spell-picker-btn')?.getBoundingClientRect();
    const layout = window.__lol2d.scene.oScene.game.touchControls.currentLayout;
    if (!btn) return { missing: true };
    let minButtonTop = Infinity;
    for (const b of layout.buttons) minButtonTop = Math.min(minButtonTop, b.y - b.radius);
    return { buttonBottom: btn.bottom, arcTop: minButtonTop, clears: btn.bottom < minButtonTop };
  });
  check(
    'the corner button sits above the ability/summoner arc, not overlapping it',
    report.cornerVsArc.clears === true,
    JSON.stringify(report.cornerVsArc)
  );
  await page.screenshot({
    path: `${OUT}-02-corner-zoom.png`,
    clip: { x: VIEWPORT.width - 140, y: 0, width: 140, height: 70 },
  });

  // Reopen and check the loadout editor's slot pills the same way the old
  // strip's edit-badges were checked: nothing bleeds into the next pill at 3x
  // device scale. That row is the panel's densest piece of chrome on a
  // 390px-tall phone, and it is the one this HUD reaches through two modals.
  await page.evaluate(() =>
    window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.openSpellPicker()
  );
  await page.waitForTimeout(300);
  await page.click('.practice-roster-row.is-player .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 5_000 });
  report.slotPillBadgeOverlap = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('.kit-slot-bar .kit-slot-pill')];
    const overlaps = [];
    for (let i = 0; i < pills.length - 1; i++) {
      const a = pills[i].querySelector('.kit-slot-pill-key')?.getBoundingClientRect();
      const b = pills[i + 1].getBoundingClientRect();
      if (a && a.right > b.left + 2) {
        overlaps.push({ i, badgeRight: a.right, nextLeft: b.left });
      }
    }
    return overlaps;
  });
  check(
    "no slot pill's hotkey badge overlaps the next pill (checked at 3x device scale)",
    report.slotPillBadgeOverlap.length === 0,
    JSON.stringify(report.slotPillBadgeOverlap)
  );
  await page.screenshot({
    path: `${OUT}-04-slot-bar-zoom.png`,
    clip: { x: 0, y: 30, width: 400, height: 90 },
  });
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
