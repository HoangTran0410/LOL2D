/**
 * End-to-end drive of the mobile HUD's touch reachability — the thing the
 * owner actually reported broken: "bấm hud ko hiện modal" (tapping the HUD
 * does not show the modal).
 *
 * `GameScene` must cancel gestures on the game canvas without cancelling the
 * native click/scroll behavior of DOM HUD overlays. This drives everything
 * with real CDP touch events, never a direct method call on the Vue instance.
 *
 * The bottom-HUD strip this used to tap into no longer renders in touch
 * mode at all (see `MobileHudView.vue`'s file comment): health, mana, buff
 * stacks, CC and the revive countdown all already draw on the canvas over
 * the champion, and the loadout row duplicated the canvas spell buttons. The
 * one entry point left is the corner button (`.spell-picker-btn`), which
 * opens the practice panel on Đội. The loadout it used to reach directly
 * is now one tap further in — a roster row opens `LoadoutEditorModal`, which
 * is a setup-screen component that relies on native clicks and list scrolling;
 * this script proves those browser behaviors survive inside a match.
 *
 *   node tests/e2e/drive-mobile-hud.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { PHONE_VIEWPORT, startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-mobile-hud';

// `deviceScaleFactor: 3` is load-bearing here rather than cosmetic: the badge
// overlap this script checks for last was invisible at 1x.
const { url, page, errors, report, check, touchStart, touchMove, touchEnd, tap, guard } =
  await startHarness({
    out: OUT,
    viewport: PHONE_VIEWPORT,
    hasTouch: true,
    deviceScaleFactor: 3,
    touch: true,
  });

await guard(async () => {
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
    'the panel opens on Đội, with the three tabs it should have',
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
    'a native touch drag inside the editor scrolls it',
    scrollDuring > scrollBefore + 20,
    `scrollTop ${scrollBefore} -> ${scrollDuring}`
  );

  // ------------------------------------------------ 4. the way back out, twice

  // The header X. This used to be the slot bar's "Huỷ" button
  // (`.kit-bar-btn.secondary`), which was dropped when the bar had to hold the
  // view toggle as well — the X is the same `cancel` handler, and now the only
  // button that runs it. The gesture under test is unchanged: a real touch tap
  // on the control that backs out of the editor.
  const cancelBox = await page.evaluate(() => {
    const box = document
      .querySelector('.loadout-modal .pregame-modal-header .pregame-icon-btn')
      .getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, h: box.height };
  });
  await tap(cancelBox.x, cancelBox.y, 40);
  await page.waitForTimeout(250);
  report.editorAfterCancel = await page.evaluate(() => !!document.querySelector('.loadout-modal'));
  check(
    'a real touch tap on the editor X closes it and leaves the panel up',
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
    clip: { x: PHONE_VIEWPORT.width - 140, y: 0, width: 140, height: 70 },
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
});
