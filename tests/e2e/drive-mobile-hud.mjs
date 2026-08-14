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
 * The bottom-HUD strip this used to tap into no longer renders in touch
 * mode at all (see `MobileHudView.vue`'s file comment): health, mana, buff
 * stacks, CC and the revive countdown all already draw on the canvas over
 * the champion, and the loadout row duplicated the canvas spell buttons. The
 * one entry point left into the picker is the corner button
 * (`.spell-picker-btn`), and since it no longer knows which slot the player
 * wants — the strip used to answer that by which icon was tapped — the
 * picker gained its own slot selector (`.slot-picker .slot-pill`). Both are
 * new surfaces this script has to prove work under a real thumb, not a
 * synthetic click, for the same reason as everything else here.
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
    'the corner spell-picker button is at least the 44px thumb target',
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
    'a real touch tap on the corner button opens the spell picker',
    pickerBeforeTap === false && report.pickerAfterRealTap === true,
    `before ${pickerBeforeTap}, after ${report.pickerAfterRealTap}`
  );
  report.slotOnOpen = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.spellIndexToSwap
  );
  check('opening from the corner button defaults to slot 1 (Q)', report.slotOnOpen === 1);
  await page.screenshot({ path: `${OUT}-01-picker-open.png` });

  // -------------------------------------------- 2. the in-modal slot selector

  const slotPills = await page.evaluate(() =>
    [...document.querySelectorAll('.slot-picker .slot-pill')].map(el => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
    })
  );
  check('the slot selector has one pill per equipped slot', slotPills.length === 7, `${slotPills.length}`);
  check(
    'each slot pill is at least the 44px thumb target',
    slotPills.every(p => p.w >= 44 && p.h >= 44),
    JSON.stringify(slotPills.map(p => `${p.w}x${p.h}`))
  );
  // Slot 2 (W) under a real tap, not a direct field write.
  await tap(slotPills[2].x, slotPills[2].y, 40);
  await page.waitForTimeout(150);
  report.slotAfterPillTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.spellIndexToSwap
  );
  check(
    'a real touch tap on a slot pill retargets which slot gets replaced',
    report.slotAfterPillTap === 2,
    `${report.slotOnOpen} -> ${report.slotAfterPillTap}`
  );

  // ------------------------------------------- 3. picking one under a thumb

  const beforePick = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[2]?.constructor.name
  );
  // Shaco is in the roster (see the desktop picker screenshot); his kit is
  // distinct from whatever the random preset gave the player, so a real
  // change is unambiguous.
  const shacoIcon = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.spell-picker .group')];
    const shaco = groups.find(g => g.querySelector('.group-header p')?.textContent?.trim() === 'Shaco');
    const icon = shaco?.querySelectorAll('.spell')[0];
    if (!icon) return null;
    // The unified compact layout is a vertical scroll; on a short landscape
    // viewport Shaco sits below the fold, so bring it into view before we read
    // its coordinates and tap them.
    icon.scrollIntoView({ block: 'center' });
    const box = icon.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  check('the Shaco group is present and tappable', shacoIcon !== null);
  if (shacoIcon) {
    await tap(shacoIcon.x, shacoIcon.y);
    await page.waitForTimeout(250);
  }
  // Picks are batched now: the tap only *stages* into slot 2's draft; the live
  // loadout must not change until "Xác nhận".
  const stagedAfterTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.draftSpells[2]?.spellClass?.name
  );
  const liveAfterTap = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[2]?.constructor.name
  );
  report.pick = { beforePick, stagedAfterTap, liveAfterTap };
  check(
    'a real touch tap stages the pick into the selected slot (2) without applying it',
    stagedAfterTap?.startsWith('Shaco') && liveAfterTap === beforePick,
    `staged=${stagedAfterTap}, live ${beforePick} -> ${liveAfterTap}`
  );
  // Confirm flushes the draft to the live loadout and closes the picker.
  const confirmBox = await page.evaluate(() => {
    const box = document.querySelector('.picker-btn.confirm').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await tap(confirmBox.x, confirmBox.y, 40);
  await page.waitForTimeout(250);
  const afterConfirm = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.spells[2]?.constructor.name
  );
  report.confirm = { afterConfirm };
  check(
    '"Xác nhận" applies the staged pick to slot 2 (and only then)',
    afterConfirm !== beforePick && afterConfirm?.startsWith('Shaco'),
    `${beforePick} -> ${afterConfirm}`
  );
  // Confirm closed the picker; reopen for the rest of the checks.
  await page.evaluate(() => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.openSpellPicker());
  await page.waitForTimeout(300);

  // --------------------------------------------------- 4. checkboxes toggle

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

  // ----------------------------------------------------------- 5. scrolling

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

  // ------------------------------- 6. a drag that starts on an icon scrolls,
  //                                    it does not also pick that icon

  // The reopen above reset the draft, so slot 2 starts unstaged; a scroll drag
  // that begins on an icon must not stage it either.
  const beforeDragStaged = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.draftSpells[2]?.spellClass?.name ?? null
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
  const afterDragStaged = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.draftSpells[2]?.spellClass?.name ?? null
  );
  check(
    'a drag that starts on a picker icon (scrolling) does not stage it',
    afterDragStaged === beforeDragStaged,
    `${beforeDragStaged} -> ${afterDragStaged}`
  );

  // ---------------------------------------------------------- 7. close button

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

  // Reopen to screenshot and check the slot pills' hotkey badges the same
  // way the old strip's edit-badges were checked: nothing bleeds into the
  // next pill at 3x device scale.
  await page.evaluate(() => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.openSpellPicker());
  await page.waitForTimeout(300);
  report.slotPillBadgeOverlap = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('.slot-picker .slot-pill')];
    const overlaps = [];
    for (let i = 0; i < pills.length - 1; i++) {
      const a = pills[i].querySelector('.slot-pill-key')?.getBoundingClientRect();
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
  await page.screenshot({ path: `${OUT}-03-slot-picker-zoom.png`, clip: { x: 0, y: 30, width: 400, height: 80 } });
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
