/**
 * End-to-end drive of the in-game practice panel — the three-tab modal that
 * reshapes a *running* match (`src/game/hud/PracticePanel.vue` over
 * `src/game/MatchDirector.ts`).
 *
 * Boots its own Vite dev server, opens the game in system Chrome through
 * Playwright, and reaches the live scene through the DEV-only `window.__lol2d`
 * handle — the same harness as the other `tests/e2e/drive-*.mjs` scripts.
 *
 * ## Why so much of this is dispatched as a real touch
 *
 * `GameScene` cancels gestures only when they originate on the game canvas.
 * The DOM panel must retain native clicks, range dragging, checkboxes and
 * momentum scrolling, so each control family here is driven at least once
 * with a real `Input.dispatchTouchEvent` through CDP.
 *
 * ## What it proves, in order
 *
 *   1. the corner button opens a panel with three tabs, and `#practice-close`
 *      closes it from *every* one of them — no tab owns an exit, and the one
 *      that used to (the deleted picker's Huỷ) left the others with no way out
 *      of a modal covering a paused match;
 *   2. Đội: a bot added while paused is on the roster at once and in
 *      `objectManager.objects` on the first unpaused tick, not before;
 *   3. swapping that bot's champion changes its name and leaves it standing
 *      exactly where it was;
 *   4. a behaviour toggle really writes `_autoMove`/`_autoAttack`/`_autoCast`
 *      (once under a thumb, once under a mouse);
 *   5. removing it marks it, and the sweep on the next tick takes it away;
 *   6. `AI_COUNT_MAX` holds *while the match is paused* — the case that
 *      actually broke: `bots()` counted only `objectManager.objects`,
 *      `ObjectManager.update()` cannot run while the panel holds the match
 *      paused, so 25 presses in one session all succeeded and the cap was
 *      unreachable. The cap is imported from `PregameConfig.ts`, never
 *      restated here;
 *   7. Trận đấu: driving `#practice-cdr` to 90 retunes `game.matchRules` and a
 *      spell instance that existed *before* the drag reports the lower
 *      `effectiveCoolDownMs` — the claim the whole "rules are live" design
 *      rests on. Compared with an epsilon: 90% CDR is `0.09999999999999998`,
 *      and `=== 0.1` fails on correct code;
 *   8. the same tab's jungle switch empties `game.monsters` and the camps are
 *      gone from the world after one tick;
 *   9. Đội: a champion's side switches live — the player Blue↔Red, row and
 *      teamId together; and, folded onto each champion's own row, the
 *      invulnerability toggle survives a close and reopen and a stack button
 *      moves the spell's own count *and* the HUD badge. The debug layers are the
 *      one thing left on Cài đặt, since they change the match, not a champion;
 *  10. an invulnerable bot stops losing health across unpaused frames while a
 *      second bot, hit identically, does not — the only check here that proves
 *      the buff works in the real loop rather than in a fixture;
 *  11. a kit saved mid-match survives a reload into a new match. Note *where*:
 *      the saved-kit shelf is not on the panel itself — it is at Đội → a
 *      unit's row → the loadout editor, which teleports out of the panel.
 *      Asserted both ways. The same reload closes the persistence round trip:
 *      everything checks 7, 8 and 10 changed is in `lol2d:pregameConfig:v1`,
 *      *and* the new match boots from it — 90% CDR, no jungle, two bots, none
 *      of which `MATCH_CONFIG` describes. This check asserted the exact
 *      opposite until the panel started persisting ("chỉ sửa trận hiện tại",
 *      reversed by `2026-08-16-panel-persistence-design`), and the half that
 *      did not reverse is asserted beside it: check 9's cheats and debug
 *      layers *do* reach storage now (see check 13's own doc comment for the
 *      reversal), and the blob's sections are exactly the six
 *      match-configuration ones plus the chosen map
 *      (ai, cheats, mapId, player, playerTeam, rules, world);
 *  12. "Đặt lại mặc định" arms on the first press and, on the second, puts the
 *      running match *and* storage back to `DEFAULT_PREGAME_CONFIG` — the
 *      clean slate persistence took away;
 *  13. Escape leaves you *in* the match with the panel open — never in the menu
 *      — and the exit button's first press does not leave either. Both are
 *      regressions a player would discover by losing a match.
 *
 *   node tests/e2e/drive-practice-panel.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { PHONE_VIEWPORT as MOBILE_VIEWPORT, startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-practice-panel';
/** Roomy enough that neither of `styles/hud.css`'s full-bleed media queries applies. */
const VIEWPORT = { width: 1280, height: 900 };
const CFG_KEY = 'lol2d:pregameConfig:v1';
const KITS_KEY = 'lol2d:savedKits:v1';
const KIT_NAME = 'E2E Kit';
const TAB_IDS = ['roster', 'rules', 'settings'];
const TAB_LABELS = ['Đội', 'Trận đấu', 'Cài đặt'];

/**
 * A deterministic match. The player is a named champion so the cooldown probe
 * in check 7 has a real spell in slot Q — Veigar specifically, because his Q
 * is one of the three spells that accumulate stacks and check 9 needs a stack
 * row to press. `ai.count` is 0 so the only bots in the match are the ones
 * this script adds — a bot rolls a random kit, and
 * every earlier task in this plan that let one into an assertion got an
 * intermittent failure out of it.
 */
const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Veigar',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: true, autoCast: true, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: false },
};

// A desktop frame with `hasTouch`, and deliberately no `?touch=1`: this script
// taps HUD controls with a real finger but never asks for the Wild Rift
// controls themselves. `check` records a mismatch instead of throwing, so one
// bad expectation cannot hide the rest of the run — that is the harness's.
const { url, page, report, check, touchStart, touchMove, touchEnd, guard } = await startHarness({
  out: OUT,
  viewport: VIEWPORT,
  hasTouch: true,
});

/** A 60ms hold rather than the harness's 70: tuned against this panel's controls. */
const tap = async (x, y, holdMs = 60) => {
  await touchStart([{ x, y }]);
  await page.waitForTimeout(holdMs);
  await touchEnd();
};

/** Centre of `selector` in viewport coordinates, scrolled into view first. */
const boxOf = selector =>
  page.evaluate(sel => {
    const element = document.querySelector(sel);
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
  }, selector);

/** A real thumb on whatever `selector` names. Throws if it is not on screen — that is a finding. */
const tapSelector = async (selector, holdMs = 60) => {
  const box = await boxOf(selector);
  if (!box) throw new Error(`nothing tappable at ${selector}`);
  await tap(box.x, box.y, holdMs);
  await page.waitForTimeout(120);
  return box;
};

// ------------------------------------------------------------ game reads

const gameEval = (fn, arg) => page.evaluate(fn, arg);

const hudFlag = () =>
  gameEval(() => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.showSpellsPicker);
const isPaused = () => gameEval(() => window.__lol2d.scene.oScene.game.paused);
const rosterCount = () => gameEval(() => window.__lol2d.scene.oScene.game.director.roster().length);
const directorBotCount = () =>
  gameEval(() => window.__lol2d.scene.oScene.game.director.bots().length);

/** Only the bots the object manager has actually taken in — deliberately not `director.bots()`. */
const liveBotIds = () =>
  gameEval(async () => {
    const AIChampion = (await import('/src/game/gameObject/attackableUnits/AIChampion.ts')).default;
    const game = window.__lol2d.scene.oScene.game;
    const ids = [];
    for (const object of game.objectManager.objects) {
      if (object instanceof AIChampion && !object.toRemove) ids.push(object.id);
    }
    return ids;
  });

const botSnapshot = id =>
  gameEval(botId => {
    const game = window.__lol2d.scene.oScene.game;
    const all = [...game.objectManager.objects, ...game.objectManager._objectToBeAdd];
    const bot = all.find(object => object.id === botId);
    if (!bot) return null;
    return {
      name: bot.name,
      x: bot.position.x,
      y: bot.position.y,
      autoMove: bot._autoMove,
      autoAttack: bot._autoAttack,
      autoCast: bot._autoCast,
      toRemove: !!bot.toRemove,
    };
  }, id);

const monsterCensus = () =>
  gameEval(async () => {
    const Monster = (await import('/src/game/gameObject/attackableUnits/Monster.ts')).default;
    const game = window.__lol2d.scene.oScene.game;
    let inWorld = 0;
    for (const object of game.objectManager.objects) if (object instanceof Monster) inWorld++;
    return { listed: game.monsters.length, inWorld };
  });

// ---------------------------------------------------------------- panel

const openPanel = async (useTouch = false) => {
  if (useTouch) await tapSelector('.spell-picker-btn');
  else await page.click('.spell-picker-btn');
  await page.waitForSelector('.practice-panel', { state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(150);
};

const selectTab = async (id, useTouch = false) => {
  if (useTouch) await tapSelector(`#practice-tab-${id}`);
  else await page.click(`#practice-tab-${id}`);
  await page.waitForTimeout(180);
};

/** Always the shell's own close, always under a thumb — check 1 is what this guards. */
const closePanel = async () => {
  await tapSelector('#practice-close');
  await page.waitForTimeout(250);
};

/** Let the unpaused match actually tick, which is the only thing that flushes adds and sweeps removals. */
const runMatch = (ms = 700) => page.waitForTimeout(ms);

const startMatch = async () => {
  await page.click('#play-btn');
  await page.waitForFunction(
    () => window.__lol2d?.scene?.oScene?.game?.inGameHUD?.vueInstance,
    null,
    {
      timeout: 30_000,
    }
  );
  await page.waitForTimeout(1_200);
};

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await gameEval(
    ({ cfgKey, kitsKey, config }) => {
      localStorage.setItem(cfgKey, JSON.stringify(config));
      localStorage.removeItem(kitsKey);
    },
    { cfgKey: CFG_KEY, kitsKey: KITS_KEY, config: MATCH_CONFIG }
  );
  await page.reload({ waitUntil: 'load' });
  await startMatch();

  // The cooldown probe: a spell instance that exists *now*, long before the
  // rules tab is ever opened. Parked on `window` because the assertion is that
  // this same object reports a different cooldown later — a fresh
  // `player.spells[1]` read after the drag would prove nothing.
  await gameEval(() => {
    window.__practiceProbe = window.__lol2d.scene.oScene.game.player.spells[1];
  });

  // ------------------------------------------- 1. four tabs, and a way out

  await openPanel(true); // the corner button, under a real thumb
  report.panelShape = await gameEval(() => ({
    tabs: [...document.querySelectorAll('.practice-tab')].map(tab => tab.textContent.trim()),
    tabIds: [...document.querySelectorAll('.practice-tab')].map(tab => tab.id),
    hasClose: !!document.querySelector('#practice-close'),
    paused: window.__lol2d.scene.oScene.game.paused,
  }));
  check(
    'a real touch on the corner button opens the panel and its tabs, over a paused match',
    JSON.stringify(report.panelShape.tabs) === JSON.stringify(TAB_LABELS) &&
      report.panelShape.hasClose &&
      report.panelShape.paused === true,
    JSON.stringify(report.panelShape)
  );
  await page.screenshot({ path: `${OUT}-01-panel.png` });

  // The close button is the shell's, not a tab's, and that is exactly what has
  // to be guarded: no tab carries an exit of its own, so on every tab this
  // button is the only way out of a modal covering a paused match.
  report.closeFromEveryTab = {};
  for (const [index, id] of TAB_IDS.entries()) {
    if (index > 0) await openPanel();
    await selectTab(id, id === 'roster'); // one of the three switched by thumb
    await closePanel();
    report.closeFromEveryTab[id] = {
      pickerFlag: await hudFlag(),
      panelInDom: await gameEval(() => !!document.querySelector('.practice-panel')),
      paused: await isPaused(),
    };
    // Recover so a single bad tab cannot take the rest of the run with it.
    if (report.closeFromEveryTab[id].pickerFlag !== false) {
      await gameEval(() =>
        window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.closeSpellPicker()
      );
      await page.waitForTimeout(200);
    }
  }
  const closedEverywhere = TAB_IDS.every(id => {
    const state = report.closeFromEveryTab[id];
    return state.pickerFlag === false && state.panelInDom === false && state.paused === false;
  });
  check(
    '#practice-close closes the panel — and unpauses the match — from every one of its tabs',
    closedEverywhere,
    JSON.stringify(report.closeFromEveryTab)
  );

  // Both HUD views mount the panel with `v-if`, so closing it unmounts the
  // component. The selected tab lives in `practice/panelTab.ts` for that
  // reason — a `ref` at the top of `<script setup>` is rebuilt on every mount,
  // which looks like module scope and is not. Asserted on the *last* tab, not
  // the first: `'roster'` is the default, so a check that opened on it would
  // pass against a panel that had forgotten everything.
  await openPanel();
  await selectTab('settings');
  await closePanel();
  await openPanel();
  report.tabPersisted = await gameEval(
    () => document.querySelector('.practice-tab.selected')?.id ?? null
  );
  await closePanel();
  check(
    'the selected tab survives closing and reopening the panel',
    report.tabPersisted === 'practice-tab-settings',
    String(report.tabPersisted)
  );

  // ------------------------------------------------- 2. Đội: add a bot

  await openPanel();
  await selectTab('roster');
  const botsBeforeAdd = await liveBotIds();
  const rosterBeforeAdd = await rosterCount();
  await tapSelector('#practice-add-bot-blue'); // real thumb
  const rosterAfterAdd = await rosterCount();
  const botsWhilePaused = await liveBotIds();
  await page.screenshot({ path: `${OUT}-02-roster.png` });
  await closePanel();
  await runMatch();
  const botsAfterTick = await liveBotIds();
  const added = botsAfterTick.filter(id => !botsBeforeAdd.includes(id));
  report.addBot = {
    rosterBeforeAdd,
    rosterAfterAdd,
    botsBeforeAdd: botsBeforeAdd.length,
    botsWhilePaused: botsWhilePaused.length,
    botsAfterTick: botsAfterTick.length,
    added: added.length,
  };
  check(
    'Đội: a bot added under a thumb is on the roster at once, in the world after one tick',
    rosterAfterAdd === rosterBeforeAdd + 1 &&
      botsWhilePaused.length === botsBeforeAdd.length &&
      added.length === 1,
    JSON.stringify(report.addBot)
  );
  const botId = added[0];
  if (!botId) throw new Error('no bot was added — the rest of the roster checks have no subject');

  // --------------------------------------------- 3. swap its champion in place

  await openPanel();
  await selectTab('roster');
  const beforeSwap = await botSnapshot(botId);
  const ROW = '.practice-roster-row:not(.is-player)';
  await tapSelector(`${ROW} .practice-roster-open`); // real thumb
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 5_000 });
  // Every control below belongs to the *setup screen's* editor, which is wired
  // to `@click` alone; it is reachable here only through `RosterTab`'s touch
  // bridge, so driving it by thumb is the point of doing it this way.
  // Two taps, because a tile is a disclosure: the first opens Zed's shelf, the
  // button inside it is what takes the kit. Driving both by thumb is the point —
  // the whole-kit button is new surface, and it is wired to `@click` alone like
  // everything else in that editor.
  await tapSelector('.kit-shelf[data-champion="Zed"] .kit-shelf-apply');
  await page.waitForSelector('.kit-shelf[data-champion="Zed"].open .kit-apply-all', {
    state: 'visible',
    timeout: 5_000,
  });
  await tapSelector('.kit-shelf[data-champion="Zed"] .kit-apply-all');
  await tapSelector('.kit-bar-btn:not(.secondary)'); // Xác nhận
  await page.waitForTimeout(250);
  const afterSwap = await botSnapshot(botId);
  report.swapChampion = { beforeSwap, afterSwap };
  check(
    "Đội: swapping a bot's champion changes its name and leaves it standing where it was",
    !!beforeSwap &&
      !!afterSwap &&
      afterSwap.name === 'Zed' &&
      beforeSwap.name !== afterSwap.name &&
      afterSwap.x === beforeSwap.x &&
      afterSwap.y === beforeSwap.y,
    JSON.stringify(report.swapChampion)
  );

  // ------------------------------------------------- 4. behaviour flags

  // The AI-behaviour toggles fold into the bot's Luyện tập card now, so open its
  // drawer first (row index 1 — the player is 0, this is the one bot).
  await tapSelector('#practice-row-toggle-1');
  const flagsBefore = await botSnapshot(botId);
  const FLAGS = '.practice-cheat-behaviour .practice-cheat-flag';
  await tapSelector(`${FLAGS}:nth-child(1)`); // "Tự di chuyển", real thumb
  const afterTouchFlag = await botSnapshot(botId);
  await page.click(`${FLAGS}:nth-child(2) input`); // "Tự tấn công", mouse
  await page.waitForTimeout(150);
  const afterMouseFlag = await botSnapshot(botId);
  report.behaviourFlags = { flagsBefore, afterTouchFlag, afterMouseFlag };
  check(
    "Đội: a behaviour toggle really flips the bot's own flag, under a thumb and under a mouse",
    afterTouchFlag.autoMove === !flagsBefore.autoMove &&
      afterTouchFlag.autoAttack === flagsBefore.autoAttack &&
      afterMouseFlag.autoAttack === !flagsBefore.autoAttack &&
      afterMouseFlag.autoMove === afterTouchFlag.autoMove &&
      afterMouseFlag.autoCast === flagsBefore.autoCast,
    JSON.stringify(report.behaviourFlags)
  );

  // ------------------------------------------------------- 5. remove it

  await tapSelector(`${ROW} .practice-remove-bot`); // real thumb
  const rosterAfterRemove = await rosterCount();
  const markedWhilePaused = await botSnapshot(botId);
  await closePanel();
  await runMatch();
  const botsAfterRemoval = await liveBotIds();
  report.removeBot = {
    rosterAfterRemove,
    markedWhilePaused: markedWhilePaused && markedWhilePaused.toRemove,
    stillThere: botsAfterRemoval.includes(botId),
  };
  check(
    'Đội: removing a bot marks it at once and the sweep takes it away on the next tick',
    rosterAfterRemove === rosterBeforeAdd &&
      markedWhilePaused?.toRemove === true &&
      !botsAfterRemoval.includes(botId),
    JSON.stringify(report.removeBot)
  );

  // ------------------------------- 6. the cap holds while the match is paused

  // The one that actually broke. `addBot`'s guard reads `bots()`, and `bots()`
  // used to count only `objectManager.objects` — which cannot grow while the
  // panel holds the match paused, so every press succeeded and the cap was
  // unreachable. Pressed by thumb, well past the limit, in one paused session.
  const AI_COUNT_MAX = await gameEval(
    async () => (await import('/src/game/config/PregameConfig.ts')).AI_COUNT_MAX
  );
  await openPanel();
  await selectTab('roster');
  const PRESSES = AI_COUNT_MAX + 15;
  for (let press = 0; press < PRESSES; press++)
    await tapSelector('#practice-add-bot-blue', 30);
  report.cap = {
    AI_COUNT_MAX,
    presses: PRESSES,
    rosterBots: await directorBotCount(),
    inWorldWhilePaused: (await liveBotIds()).length,
    addButtonDisabled: await gameEval(
      () => document.querySelector('#practice-add-bot-blue').disabled
    ),
    countLabel: await gameEval(
      () => document.querySelector('.practice-add-bot-count')?.textContent.trim() ?? null
    ),
  };
  await page.screenshot({ path: `${OUT}-03-cap.png` });
  check(
    `Đội: ${PRESSES} presses while paused stop at AI_COUNT_MAX (${AI_COUNT_MAX}), imported not hardcoded`,
    report.cap.rosterBots === AI_COUNT_MAX &&
      report.cap.inWorldWhilePaused === 0 &&
      report.cap.addButtonDisabled === true &&
      report.cap.countLabel === `${AI_COUNT_MAX}/${AI_COUNT_MAX}`,
    JSON.stringify(report.cap)
  );
  // Clear the field again — ten bots fighting is noise every later check pays for.
  await gameEval(() => {
    const director = window.__lol2d.scene.oScene.game.director;
    for (const bot of director.bots()) director.removeBot(bot);
  });
  await closePanel();
  await runMatch();

  // -------------------------------------------------- 7. Trận đấu: CDR is live

  await openPanel();
  await selectTab('rules', true); // one tab switch under a thumb

  /**
   * The scroll check runs on **Cài đặt**, not on the tab selected above.
   *
   * It used to run on Trận đấu, which was then the long tab — it carried the
   * render settings, the zoom slider and fullscreen as well as the rules. Those
   * moved to Cài đặt when the setup screen and this panel became one, and Trận
   * đấu is now four toggles and two buttons: on a 390px landscape phone it does
   * not overflow, so there is nothing to scroll and a drag correctly does
   * nothing. Asserting "scrollTop > 0" there was measuring the old layout.
   *
   * What the check is actually for — a hand-rolled scroll under a thumb, since
   * `GameScene` cancels touch defaults — is unchanged, and Cài đặt is where a
   * body that overflows now lives.
   */
  await selectTab('settings', true);
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.waitForTimeout(100);
  const rulesBody = await page.locator('.practice-tab-body').boundingBox();
  if (!rulesBody) throw new Error('Cài đặt body has no bounding box');
  await gameEval(() => {
    document.querySelector('.practice-tab-body').scrollTop = 0;
  });
  await touchStart([{ x: rulesBody.x + rulesBody.width / 2, y: rulesBody.y + rulesBody.height - 24 }]);
  await page.waitForTimeout(80);
  await touchMove([{ x: rulesBody.x + rulesBody.width / 2, y: rulesBody.y + 24 }]);
  await page.waitForTimeout(80);
  await touchEnd();
  await page.waitForTimeout(200);
  report.rulesScrollTop = await gameEval(
    () => document.querySelector('.practice-tab-body')?.scrollTop ?? 0
  );
  /**
   * The drag is a vertical swipe across a tab that now contains a range input,
   * and a swipe that starts on one moves it — that is the browser's own
   * behaviour for `<input type="range">`, not something this panel decides. It
   * nudged the zoom a step and left it stored, which the "a fresh touch game
   * starts at 100%" check below then read as the game's own doing. Put it back
   * before moving on.
   */
  await gameEval(() => {
    const camera = window.__lol2d.scene.oScene.game.camera;
    camera.setZoomFactor(1);
    camera.snapToScale();
    localStorage.removeItem('lol2d.zoomFactor.touch');
    localStorage.removeItem('lol2d.zoomFactor');
  });
  check(
    'Cài đặt: native touch drag scrolls the modal body',
    report.rulesScrollTop > 0,
    `scrollTop=${report.rulesScrollTop}`
  );
  await gameEval(() => {
    document.querySelector('.practice-tab-body').scrollTop = 0;
  });
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(100);
  report.zoomInitial = await gameEval(() => {
    const camera = window.__lol2d.scene.oScene.game.camera;
    return {
      factor: camera.zoomFactor,
      scale: camera.scale,
      currentScale: camera.currentScale,
      storedTouch: localStorage.getItem('lol2d.zoomFactor.touch'),
    };
  });
  check(
    'Trận đấu: a fresh touch game starts at 100% zoom',
    report.zoomInitial.factor === 1 && report.zoomInitial.storedTouch === null,
    JSON.stringify(report.zoomInitial)
  );
  await page.locator('#practice-zoom').evaluate(element => {
    element.value = '1.3';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  report.zoomWhilePaused = await gameEval(() => {
    const camera = window.__lol2d.scene.oScene.game.camera;
    return {
      factor: camera.zoomFactor,
      scale: camera.scale,
      currentScale: camera.currentScale,
      storedTouch: localStorage.getItem('lol2d.zoomFactor.touch'),
    };
  });
  check(
    'Trận đấu: zoom snaps immediately while paused and stores the touch preference',
    report.zoomWhilePaused.factor === 1.3 &&
      report.zoomWhilePaused.storedTouch === '1.3' &&
      Math.abs(report.zoomWhilePaused.currentScale - report.zoomWhilePaused.scale) < 1e-9,
    JSON.stringify(report.zoomWhilePaused)
  );
  // Back to Trận đấu: the rules and the display settings used to share a tab and
  // no longer do — zoom is the device's, CDR is the match's.
  await selectTab('rules');
  const beforeCdr = await gameEval(() => ({
    multiplier: window.__lol2d.scene.oScene.game.matchRules.cooldownMultiplier,
    probeCooldownMs: window.__practiceProbe.effectiveCoolDownMs,
    probeIsStillEquipped:
      window.__practiceProbe === window.__lol2d.scene.oScene.game.player.spells[1],
    label: document.querySelector('#practice-cdr-value')?.textContent ?? null,
  }));
  // A real native drag across the range track.
  const track = await boxOf('#practice-cdr');
  await touchStart([{ x: track.x, y: track.y }]);
  await page.waitForTimeout(80);
  await touchMove([{ x: track.x + track.w, y: track.y }]);
  await page.waitForTimeout(80);
  await touchEnd();
  await page.waitForTimeout(200);
  const afterCdr = await gameEval(() => ({
    multiplier: window.__lol2d.scene.oScene.game.matchRules.cooldownMultiplier,
    probeCooldownMs: window.__practiceProbe.effectiveCoolDownMs,
    label: document.querySelector('#practice-cdr-value')?.textContent ?? null,
    slider: document.querySelector('#practice-cdr').value,
  }));
  report.cdr = { beforeCdr, afterCdr };
  await page.screenshot({ path: `${OUT}-04-rules.png` });
  check(
    'Trận đấu: a touch drag to 90% CDR writes game.matchRules (0.1 within epsilon, not ===)',
    afterCdr.slider === '90' &&
      afterCdr.label === '90%' &&
      Math.abs(afterCdr.multiplier - 0.1) < 1e-9,
    JSON.stringify({ ...report.cdr, exact: afterCdr.multiplier })
  );
  check(
    'Trận đấu: a spell instance that existed before the drag reports the lower cooldown',
    beforeCdr.probeIsStillEquipped === true &&
      beforeCdr.probeCooldownMs > 0 &&
      afterCdr.probeCooldownMs < beforeCdr.probeCooldownMs &&
      Math.abs(afterCdr.probeCooldownMs - beforeCdr.probeCooldownMs * 0.1) < 1e-6,
    `${beforeCdr.probeCooldownMs}ms -> ${afterCdr.probeCooldownMs}ms`
  );

  // ------------------------------------- 8. the same tab's jungle switch off

  // No tab change: the world toggles moved onto Trận đấu, under the three
  // rules controls check 7 just drove.
  const monstersBefore = await monsterCensus();
  await tapSelector('#practice-jungle'); // real thumb on the checkbox
  const jungleFlag = await gameEval(() => window.__lol2d.scene.oScene.game.director.jungleEnabled);
  await page.screenshot({ path: `${OUT}-05-rules-world.png` });
  await closePanel();
  await runMatch();
  report.zoomAfterClose = await gameEval(() => {
    const camera = window.__lol2d.scene.oScene.game.camera;
    return { factor: camera.zoomFactor, scale: camera.scale, currentScale: camera.currentScale };
  });
  check(
    'closing settings keeps the chosen zoom with no stale-scale jump',
    report.zoomAfterClose.factor === 1.3 &&
      Math.abs(report.zoomAfterClose.currentScale - report.zoomAfterClose.scale) < 1e-6,
    JSON.stringify(report.zoomAfterClose)
  );
  const monstersAfter = await monsterCensus();
  report.jungle = { monstersBefore, jungleFlag, monstersAfter };
  check(
    'Trận đấu: unchecking the jungle empties game.monsters and clears the camps out of the world',
    monstersBefore.listed > 0 &&
      monstersBefore.inWorld > 0 &&
      jungleFlag === false &&
      monstersAfter.listed === 0 &&
      monstersAfter.inWorld === 0,
    JSON.stringify(report.jungle)
  );

  // ----------------- 9. Đội: per-unit cheats folded onto the champion's row

  await openPanel();
  await selectTab('roster', true); // one of the three switched by thumb

  // The headline of this tab: a champion changes sides live. Switch the player
  // Blue→Red and back, and confirm the unit's teamId and which section its row
  // sits under move together — a real reassignment, not a label. The player is
  // switchable too, which is why this drives the player and not a bot.
  const teamBefore = await gameEval(() => window.__lol2d.scene.oScene.game.player.teamId);
  await tapSelector('.practice-roster-row.is-player .practice-team-switch'); // real thumb
  const teamAfterSwitch = await gameEval(() => ({
    teamId: window.__lol2d.scene.oScene.game.player.teamId,
    underRed: !!document.querySelector('.practice-team--red .practice-roster-row.is-player'),
    underBlue: !!document.querySelector('.practice-team--blue .practice-roster-row.is-player'),
  }));
  await tapSelector('.practice-team--red .practice-roster-row.is-player .practice-team-switch');
  const teamAfterSwitchBack = await gameEval(
    () => window.__lol2d.scene.oScene.game.player.teamId
  );
  report.teamSwitch = { teamBefore, teamAfterSwitch, teamAfterSwitchBack };
  check(
    'Đội: the switch moves the player to the other side — row and teamId together — and back',
    teamBefore === 'team-blue' &&
      teamAfterSwitch.teamId === 'team-red' &&
      teamAfterSwitch.underRed === true &&
      teamAfterSwitch.underBlue === false &&
      teamAfterSwitchBack === 'team-blue',
    JSON.stringify(report.teamSwitch)
  );

  // Bất tử, hồi đầy/xoá hồi chiêu and the stack rows live inside a champion's
  // own drawer now, not behind a unit picker on a separate tab — so open the
  // player's drawer (row 0) to reach them.
  await tapSelector('#practice-row-toggle-0');
  const cheatShape = await gameEval(() => ({
    invuln: !!document.querySelector('#practice-cheat-invuln-0'),
    stackRows: [...document.querySelectorAll('[data-cheat-stack]')].map(
      row => row.dataset.cheatStack
    ),
  }));
  await page.screenshot({ path: `${OUT}-06-cheats.png` });
  check(
    'Đội: the player drawer carries an invuln toggle and one stack row for its one stacking spell',
    cheatShape.invuln === true && cheatShape.stackRows.length === 1,
    JSON.stringify(cheatShape)
  );

  // The toggle, on the player (row 0).
  await tapSelector('#practice-cheat-invuln-0');
  const invulnAfterTap = await gameEval(() =>
    window.__lol2d.scene.oScene.game.director.isInvulnerable(
      window.__lol2d.scene.oScene.game.player
    )
  );
  await closePanel();
  await openPanel();
  await selectTab('roster');
  // The drawer resets on remount — re-open it to reach the toggle again.
  await tapSelector('#practice-row-toggle-0');
  const invulnAfterReopen = await gameEval(() => ({
    checkbox: document.querySelector('#practice-cheat-invuln-0').checked,
    director: window.__lol2d.scene.oScene.game.director.isInvulnerable(
      window.__lol2d.scene.oScene.game.player
    ),
  }));
  // And off again, on the reopened panel. Both directions, because
  // `deactivateBuff()` only *marks* the buff and `AttackableUnit.update()`
  // cannot run while the panel holds the match paused — a toggle that only
  // ever counted buffs would report "still on" here and refuse to come back
  // on afterwards.
  await tapSelector('#practice-cheat-invuln-0');
  const invulnAfterSecondTap = await gameEval(() => ({
    checkbox: document.querySelector('#practice-cheat-invuln-0').checked,
    director: window.__lol2d.scene.oScene.game.director.isInvulnerable(
      window.__lol2d.scene.oScene.game.player
    ),
  }));
  report.invulnToggle = { invulnAfterTap, invulnAfterReopen, invulnAfterSecondTap };
  check(
    'Đội: the invulnerability toggle survives a close and reopen, and still switches off',
    invulnAfterTap === true &&
      invulnAfterReopen.director === true &&
      invulnAfterReopen.checkbox === true &&
      invulnAfterSecondTap.director === false &&
      invulnAfterSecondTap.checkbox === false,
    JSON.stringify(report.invulnToggle)
  );

  // The debug layers, on the Cài đặt tab (they change the whole match, not a
  // champion, so they stayed there when the per-unit cheats moved). `routes` is
  // the one worth driving: the checkbox and the `N` key must write one field,
  // not two — so this taps the checkbox and reads `navigation.debugRoutes`, the
  // field the key flips.
  await selectTab('settings', true);
  await tapSelector('#practice-debug-routes');
  await tapSelector('#practice-debug-terrain');
  const debugAfterTaps = await gameEval(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      routes: game.director.debug.routes,
      navigation: game.navigation.debugRoutes,
      terrain: game.director.debug.terrain,
      collision: game.director.debug.collision,
    };
  });
  // Off again, so nothing after this point renders through a debug overlay.
  await tapSelector('#practice-debug-routes');
  await tapSelector('#practice-debug-terrain');
  const debugAfterOff = await gameEval(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      routes: game.director.debug.routes,
      navigation: game.navigation.debugRoutes,
      terrain: game.director.debug.terrain,
      checkbox: document.querySelector('#practice-debug-terrain').checked,
    };
  });
  report.debugLayers = { debugAfterTaps, debugAfterOff };
  check(
    'Cài đặt: the debug toggles switch their layer, and routes is the same field the N key flips',
    debugAfterTaps.routes === true &&
      debugAfterTaps.navigation === true &&
      debugAfterTaps.terrain === true &&
      debugAfterTaps.collision === false &&
      debugAfterOff.routes === false &&
      debugAfterOff.navigation === false &&
      debugAfterOff.terrain === false &&
      debugAfterOff.checkbox === false,
    JSON.stringify(report.debugLayers)
  );

  // The stack row updates the live spell and the visible tab immediately. The
  // covered HUD deliberately stays on its last snapshot while the panel has
  // paused the match; rebuilding it at 20Hz under the modal was wasted work.
  // Back on the Đội tab, with the player's drawer re-opened — the stack row is
  // inside it, and the debug detour above left us on Cài đặt.
  await selectTab('roster');
  await tapSelector('#practice-row-toggle-0');
  const stackId = cheatShape.stackRows[0];
  const stacksBefore = await gameEval(
    () => window.__lol2d.scene.oScene.game.player.spells[1].stackCount
  );
  await tapSelector(`[data-cheat-stack="${stackId}"] .practice-cheat-btn:nth-child(2)`);
  await page.waitForTimeout(250);
  const stacksAfter = await gameEval(() => ({
    spell: window.__lol2d.scene.oScene.game.player.spells[1].stackCount,
    tabBadge: document.querySelector('.practice-cheat-stack-count')?.textContent?.trim() ?? null,
  }));
  // The HUD badge lives on the *desktop* strip (`DesktopHudView.vue`), and this
  // page is a touch context, so `MobileHudView` — which has no strip — is what
  // renders. Flip the mode for the read and flip it straight back. Note the
  // flip remounts the panel with it (both views own one), which is why the tab
  // badge is read *before* this and the roster tab is re-selected after.
  await gameEval(() => window.__lol2d.scene.oScene.game.setTouchControlsEnabled(false, false));
  await page.waitForTimeout(300);
  const hudBadge = await gameEval(() => ({
    icons: document.querySelectorAll('.bottom-HUD .spells .spell').length,
    badge:
      document
        .querySelectorAll('.bottom-HUD .spells .spell')[1]
        ?.querySelector('.stacks')
        ?.textContent?.trim() ?? null,
  }));
  await gameEval(() => window.__lol2d.scene.oScene.game.setTouchControlsEnabled(true, false));
  await page.waitForTimeout(300);
  report.stacks = { stacksBefore, stacksAfter, hudBadge };
  check(
    "Đội: +10 updates the live spell/tab while the covered HUD snapshot stays paused",
    stacksBefore === 0 &&
      stacksAfter.spell === 10 &&
      stacksAfter.tabBadge === '10' &&
      hudBadge.icons > 1 &&
      hudBadge.badge === '0',
    JSON.stringify(report.stacks)
  );

  // ---------------------- 10. an invulnerable bot really stops taking damage

  // Two bots, added through the roster tab and flushed into the world by a
  // tick — check 6 cleared the field, and this check needs a pair.
  await selectTab('roster');
  // Both on Blue, so "row 1 is the first bot, row 2 is the control" below is
  // about two units on one side rather than about how the sides were balanced.
  await tapSelector('#practice-add-bot-blue');
  await tapSelector('#practice-add-bot-blue');
  await closePanel();
  await runMatch();
  await openPanel();
  await selectTab('roster');

  // Row 1 is the first bot; row 2 is the control, hit identically with no buff.
  // The paired control is the point: "health unchanged" on its own would pass
  // against a takeDamage that dropped everything. The invuln toggle is inside
  // the bot's own drawer now — open row 1's, wherever its team put it.
  await tapSelector('#practice-row-toggle-1');
  await tapSelector('#practice-cheat-invuln-1');
  const immuneId = await gameEval(
    () => window.__lol2d.scene.oScene.game.director.roster()[1].unit.id
  );
  const controlId = await gameEval(
    () => window.__lol2d.scene.oScene.game.director.roster()[2].unit.id
  );
  await closePanel();

  // Unpaused from here: `Game.update()` runs, which is the loop the fixture
  // tests cannot exercise.
  const beatenUp = await gameEval(
    ids => {
      const game = window.__lol2d.scene.oScene.game;
      const find = id => game.objectManager.objects.find(object => object.id === id);
      const immune = find(ids.immuneId);
      const control = find(ids.controlId);
      if (!immune || !control) return null;
      const before = {
        immune: immune.stats.health.baseValue,
        control: control.stats.health.baseValue,
      };
      for (let i = 0; i < 5; i++) {
        immune.takeDamage(50);
        control.takeDamage(50);
      }
      return before;
    },
    { immuneId, controlId }
  );
  await runMatch(700);
  const afterFrames = await gameEval(
    ids => {
      const game = window.__lol2d.scene.oScene.game;
      const find = id => game.objectManager.objects.find(object => object.id === id);
      const immune = find(ids.immuneId);
      const control = find(ids.controlId);
      return {
        immune: immune ? immune.stats.health.baseValue : null,
        control: control ? control.stats.health.baseValue : null,
        immuneDead: immune ? immune.isDead : null,
      };
    },
    { immuneId, controlId }
  );
  report.invulnInLoop = { beatenUp, afterFrames };
  check(
    'an invulnerable bot keeps its health across unpaused frames, and the control bot does not',
    beatenUp !== null &&
      afterFrames.immune >= beatenUp.immune &&
      afterFrames.immuneDead === false &&
      afterFrames.control < beatenUp.control,
    JSON.stringify(report.invulnInLoop)
  );

  // --------------------------- 11. a kit saved mid-match survives a new match

  await openPanel();
  const shelfOnPanelOpen = await gameEval(
    () => !!document.querySelector('.practice-panel .saved-kit-shelf')
  );
  await selectTab('roster');
  await tapSelector('.practice-roster-row.is-player .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 5_000 });
  const shelfBeforeSaving = await gameEval(() => !!document.querySelector('.saved-kit-shelf'));

  /**
   * Make the draft a *custom* kit before saving one.
   *
   * "Lưu bộ" is `v-if="isCustomKit"` — a saved kit is a hand-assembled one, and
   * a whole champion is already reachable by name from the roster, so there is
   * nothing to store. The player is on Zed at this point (check 5 applied the
   * whole kit), i.e. `mode: 'champion'`, and the button correctly does not
   * exist. This step predates that rule and had been failing on it since.
   *
   * The dice on the slot bar is the cheapest way across: `randomizeSlot` goes
   * through `writeSlots`, which calls `toCustom`. One tap, no catalogue search,
   * and it leaves a kit that is still worth saving by name.
   */
  await tapSelector('.kit-slot-random');
  await page.waitForSelector('.saved-kit-save', { state: 'visible', timeout: 5_000 });

  await tapSelector('.saved-kit-save'); // "Lưu bộ", through the touch bridge
  await page.waitForSelector('.saved-kit-form', { state: 'visible', timeout: 5_000 });
  await tapSelector('.saved-kit-input');
  const nameFieldFocused = await gameEval(
    () => document.activeElement?.classList?.contains('saved-kit-input') === true
  );
  // The field is prefilled with the champion the draft is ("Ahri"); select
  // before typing so the stored name is exactly what this script asserts on.
  await gameEval(() => document.querySelector('.saved-kit-input').select());
  await page.keyboard.type(KIT_NAME);
  await tapSelector('.saved-kit-confirm');
  await page.waitForTimeout(250);
  const storedKits = await gameEval(key => localStorage.getItem(key), KITS_KEY);
  const storedConfig = await gameEval(key => localStorage.getItem(key), CFG_KEY);
  await page.screenshot({ path: `${OUT}-06-save-kit.png` });
  // Back out without committing — a save is not a commit, which is the whole
  // point of this check. The header X, since the slot bar's "Huỷ" button was
  // dropped when the bar had to hold the roster's view toggle as well; it is
  // the same `cancel` handler that button called.
  await tapSelector('.loadout-modal .pregame-modal-header .pregame-icon-btn');
  try {
    const discardBtn = await page.waitForSelector('.kit-unsaved-discard', {
      state: 'visible',
      timeout: 150,
    });
    if (discardBtn) await discardBtn.click();
  } catch {
    // No unsaved changes dialog if not prompted
  }
  await page.waitForTimeout(200);
  await closePanel();

  await page.reload({ waitUntil: 'load' });
  await startMatch();
  // Read before anything is touched: this is the match the *stored* config
  // booted, which is the second half of the persistence round trip (the first
  // half — what got written — is asserted below).
  const matchAfterReload = await gameEval(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      cooldownMultiplier: game.matchRules.cooldownMultiplier,
      jungleEnabled: game.director.jungleEnabled,
      monsters: game.monsters.length,
      bots: game.director.bots().length,
      zoomFactor: game.camera.zoomFactor,
      zoomScale: game.camera.scale,
      zoomCurrentScale: game.camera.currentScale,
    };
  });
  await openPanel();
  const shelfOnPanelOpenAfterReload = await gameEval(
    () => !!document.querySelector('.practice-panel .saved-kit-shelf')
  );
  await selectTab('roster');
  await tapSelector('.practice-roster-row.is-player .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 5_000 });
  const shelfAfterReload = await gameEval(() => ({
    hasShelf: !!document.querySelector('.saved-kit-shelf'),
    names: [...document.querySelectorAll('.saved-kit')].map(kit => kit.dataset.kit),
    applyButtons: document.querySelectorAll('.saved-kit-apply').length,
  }));
  await page.screenshot({ path: `${OUT}-07-kit-after-reload.png` });
  // Field by field rather than a string compare: what the panel changed is in
  // the stored config, what it did not is untouched, and what must never be
  // stored is absent.
  const storedParsed = JSON.parse(storedConfig ?? 'null');
  report.savedKit = {
    shelfOnPanelOpen,
    shelfBeforeSaving,
    nameFieldFocused,
    storedKitNames: JSON.parse(storedKits ?? '[]').map(kit => kit.name),
    shelfOnPanelOpenAfterReload,
    shelfAfterReload,
    storedPregame: storedParsed && {
      championName: storedParsed.player?.championName,
      aiCount: storedParsed.ai?.count,
      rules: storedParsed.rules,
      world: storedParsed.world,
      cheats: storedParsed.cheats,
      sections: Object.keys(storedParsed).sort(),
    },
  };
  check(
    'a kit saved mid-match is still on the shelf after a reload into a new match',
    nameFieldFocused === true &&
      shelfBeforeSaving === false &&
      report.savedKit.storedKitNames.includes(KIT_NAME) &&
      shelfAfterReload.hasShelf === true &&
      shelfAfterReload.names.includes(KIT_NAME) &&
      shelfAfterReload.applyButtons >= 1,
    JSON.stringify(report.savedKit)
  );
  check(
    'the shelf lives in the loadout editor off Đội, never on the panel itself',
    shelfOnPanelOpen === false && shelfOnPanelOpenAfterReload === false,
    `panel before ${shelfOnPanelOpen}, after reload ${shelfOnPanelOpenAfterReload}`
  );
  // The reversal, asserted where its opposite used to be. This check read
  // `pregameConfigUntouched` until the panel started persisting: the panel
  // wrote nothing, and CDR 90 in the stored config was the symptom of a leak.
  // It is now the proof — the CDR drag from check 7, the jungle switch from
  // check 8 and the two bots from check 10 are all in storage, while the
  // player's champion, which nothing committed a change to, is not disturbed.
  check(
    'the panel writes what it changed through to the pregame config',
    report.savedKit.storedPregame?.rules?.cooldownReductionPercent === 90 &&
      report.savedKit.storedPregame?.rules?.manaFree === false &&
      report.savedKit.storedPregame?.world?.jungle === false &&
      report.savedKit.storedPregame?.world?.minions === true &&
      report.savedKit.storedPregame?.aiCount === 2 &&
      report.savedKit.storedPregame?.championName === MATCH_CONFIG.player.championName,
    JSON.stringify(report.savedKit.storedPregame)
  );
  /**
   * The other half of the line, and the one worth having a real browser for.
   *
   * **This assertion used to be the opposite**, and the reversal is the point
   * rather than a relaxation. The rule was "match configuration persists,
   * session state does not": cheats and debug layers were things a player
   * switched on to try something, and an invulnerable champion nobody
   * remembered asking for would be a bug report rather than a restored setting.
   *
   * What changed is that the setup screen and this panel became one panel,
   * mounted over the menu as well as over a match. One panel with two classes
   * of control — one that comes back and one that silently does not — is worse
   * to explain than a cheat that stays on, and the old rule was invisible from
   * the control itself. Legibility pays for it instead: the roster row marks an
   * invulnerable participant without the drawer being open.
   *
   * Stack counts are still *not* stored — they are a count on a live spell
   * instance, not a setting — so `stack` stays on the forbidden list while the
   * other three move to the required one.
   */
  report.savedKit.cheatWordsInBlob = ['stack'].filter(word =>
    (storedConfig ?? '').toLowerCase().includes(word)
  );
  /**
   * Both directions in one blob, which is what makes this worth reading rather
   * than just "cheats persist":
   *
   *   - check 10 made the **first bot** invulnerable and left it that way, so
   *     `botInvulnerable[0]` is `true` and its neighbour — the control bot,
   *     deliberately untouched — is `false`;
   *   - check 9 switched the player's invulnerability and two debug layers on
   *     and then **off again**, so those read `false`. Off has to persist as
   *     surely as on, or switching a cheat off would leave it stored on.
   */
  check(
    'the cheats and debug layers reach the stored config, and stack counts do not',
    report.savedKit.cheatWordsInBlob.length === 0 &&
      report.savedKit.storedPregame?.cheats?.botInvulnerable?.[0] === true &&
      report.savedKit.storedPregame?.cheats?.botInvulnerable?.[1] === false &&
      report.savedKit.storedPregame?.cheats?.playerInvulnerable === false &&
      report.savedKit.storedPregame?.cheats?.debug?.terrain === false &&
      JSON.stringify(report.savedKit.storedPregame?.sections) ===
        JSON.stringify(['ai', 'cheats', 'mapId', 'player', 'playerTeam', 'rules', 'world']),
    JSON.stringify({
      words: report.savedKit.cheatWordsInBlob,
      cheats: report.savedKit.storedPregame?.cheats,
      sections: report.savedKit.storedPregame?.sections,
    })
  );
  // And the round trip closes: the reload above booted a *new* `Game` from that
  // stored config, so the match now running has to be the match check 7, 8 and
  // 10 shaped — 90% CDR, no jungle, two bots — rather than the one
  // `MATCH_CONFIG` describes (0% CDR, a jungle, no bots at all).
  check(
    'the reloaded match boots from the persisted config, not from the config the run started with',
    Math.abs(matchAfterReload.cooldownMultiplier - 0.1) < 1e-9 &&
      matchAfterReload.jungleEnabled === false &&
      matchAfterReload.monsters === 0 &&
      matchAfterReload.bots === 2,
    JSON.stringify(matchAfterReload)
  );
  check(
    'the touch zoom preference survives a full reload at the snapped scale',
    matchAfterReload.zoomFactor === 1.3 &&
      Math.abs(matchAfterReload.zoomCurrentScale - matchAfterReload.zoomScale) < 1e-9,
    JSON.stringify(matchAfterReload)
  );

  // ------------------------- 12. "Đặt lại mặc định" — the clean slate, back
  //
  // Persisting everything took the fresh match away; this is what hands it
  // back, and it has to do it *now* rather than at the next match. Driven here,
  // on the reloaded match, because that match is the persisted one — 90% CDR,
  // no jungle, two bots — so there is something real to reset.

  // The header X — see check 11 for why it is no longer the slot bar's Huỷ.
  await tapSelector('.loadout-modal .pregame-modal-header .pregame-icon-btn');
  await page.waitForTimeout(200);
  await selectTab('rules');
  await tapSelector('#practice-reset');
  const afterFirstReset = await gameEval(() => ({
    label: document.querySelector('#practice-reset')?.textContent?.trim() ?? null,
    cdr: window.__lol2d.scene.oScene.game.director.getRules().cooldownReductionPercent,
  }));
  await page.screenshot({ path: `${OUT}-08-reset-confirm.png` });
  await tapSelector('#practice-reset');
  /**
   * The bot count comes from `DEFAULT_PREGAME_CONFIG`, not from a literal.
   *
   * This waited for `=== 5` and had done since before commit 41ab2eb moved the
   * default from 5 to 3 — it never went red because the step above it was
   * failing first, so nothing here had run in a long time. The vitest suites
   * asserting the same thing stayed green throughout precisely because they
   * read the constant (`expect(director.bots()).toHaveLength(
   * DEFAULT_PREGAME_CONFIG.ai.count)`). Copying a value out of the config is
   * the whole bug; read it.
   */
  const defaultBotCount = await gameEval(async () => {
    const config = await import('/src/game/config/PregameConfig.ts');
    return config.DEFAULT_PREGAME_CONFIG.ai.count;
  });
  await page.waitForFunction(n => {
    const game = window.__lol2d?.scene?.oScene?.game;
    return (
      game?.director?.getRules().cooldownReductionPercent === 0 &&
      game.director.bots().length === n &&
      game.director.jungleEnabled === true &&
      game.director.minionsEnabled === true
    );
  }, defaultBotCount);
  const afterReset = await gameEval(key => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      cdrLabel: document.querySelector('#practice-cdr-value')?.textContent ?? null,
      jungleChecked: document.querySelector('#practice-jungle')?.checked ?? null,
      cooldownMultiplier: game.matchRules.cooldownMultiplier,
      jungleEnabled: game.director.jungleEnabled,
      // The camps are back in `game.monsters` at once — `spawnJungle()` fills
      // it synchronously — even though the world does not see them until the
      // match unpauses. That is the "applies now" half of the button.
      monsters: game.monsters.length,
      bots: game.director.bots().length,
      stored: JSON.parse(localStorage.getItem(key) ?? 'null'),
    };
  }, CFG_KEY);
  await page.screenshot({ path: `${OUT}-09-reset-done.png` });
  report.reset = { afterFirstReset, afterReset };
  check(
    'the reset button asks first: one press only arms it',
    afterFirstReset.label === 'Chắc chưa?' && afterFirstReset.cdr === 90,
    JSON.stringify(afterFirstReset)
  );
  check(
    'Đặt lại mặc định restores the defaults in the running match and in storage',
    afterReset.cooldownMultiplier === 1 &&
      afterReset.jungleEnabled === true &&
      afterReset.monsters > 0 &&
      afterReset.bots === defaultBotCount &&
      afterReset.stored?.rules?.cooldownReductionPercent === 0 &&
      afterReset.stored?.world?.jungle === true &&
      afterReset.stored?.ai?.count === defaultBotCount &&
      // The tab re-reads the director after resetting, so the controls show the
      // match rather than the settings that are gone.
      afterReset.cdrLabel === '0%' &&
      afterReset.jungleChecked === true,
    JSON.stringify(report.reset)
  );

  // ------------------ 13. Escape stays in the match; the exit button confirms
  //
  // Last, because the second half of it leaves the match on purpose. The
  // regression both halves guard is a player losing a match to one keypress —
  // which is what Escape did until this change.

  await closePanel();

  const beforeEscape = await gameEval(() => ({
    scene: window.__lol2d.scene.oScene.constructor.name,
    panel: !!document.querySelector('.practice-panel'),
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const afterEscape = await gameEval(() => ({
    scene: window.__lol2d.scene.oScene.constructor.name,
    gameAlive: !!window.__lol2d.scene.oScene.game,
    panel: !!document.querySelector('.practice-panel'),
    paused: window.__lol2d.scene.oScene.game?.paused ?? null,
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const afterSecondEscape = await gameEval(() => ({
    scene: window.__lol2d.scene.oScene.constructor.name,
    gameAlive: !!window.__lol2d.scene.oScene.game,
    panel: !!document.querySelector('.practice-panel'),
  }));
  report.escape = { beforeEscape, afterEscape, afterSecondEscape };
  check(
    'Escape opens the panel and leaves you in the match — it never returns to the menu',
    beforeEscape.scene === 'GameScene' &&
      beforeEscape.panel === false &&
      afterEscape.scene === 'GameScene' &&
      afterEscape.gameAlive === true &&
      afterEscape.panel === true &&
      afterEscape.paused === true &&
      afterSecondEscape.scene === 'GameScene' &&
      afterSecondEscape.gameAlive === true &&
      afterSecondEscape.panel === false,
    JSON.stringify(report.escape)
  );

  await openPanel();
  await selectTab('rules');
  await tapSelector('#practice-exit');
  const afterFirstPress = await gameEval(() => ({
    scene: window.__lol2d.scene.oScene.constructor.name,
    gameAlive: !!window.__lol2d.scene.oScene.game,
    label: document.querySelector('#practice-exit')?.textContent?.trim() ?? null,
  }));
  await page.screenshot({ path: `${OUT}-10-exit-confirm.png` });
  await tapSelector('#practice-exit');
  await page.waitForTimeout(600);
  const afterConfirm = await gameEval(() => ({
    scene: window.__lol2d.scene.oScene.constructor.name,
    gameAlive: !!window.__lol2d.scene.oScene.game,
    panel: !!document.querySelector('.practice-panel'),
  }));
  report.exitButton = { afterFirstPress, afterConfirm };
  check(
    'the exit button asks first: one press only arms it, the second leaves',
    afterFirstPress.scene === 'GameScene' &&
      afterFirstPress.gameAlive === true &&
      afterFirstPress.label === 'Chắc chưa?' &&
      afterConfirm.scene === 'MenuScene' &&
      !afterConfirm.gameAlive &&
      afterConfirm.panel === false,
    JSON.stringify(report.exitButton)
  );
}, {
  // Never leave either key behind for the next script in the suite. Runs
  // whether the body above passed or threw; a throw in here is its own
  // recorded failure rather than replacing whatever the body already found.
  cleanup: async () => {
    await page.evaluate(
      keys => keys.forEach(key => localStorage.removeItem(key)),
      [KITS_KEY, CFG_KEY]
    );
    report.storageAfterCleanup = await page.evaluate(
      keys => keys.map(key => localStorage.getItem(key)),
      [KITS_KEY, CFG_KEY]
    );
  },
});
