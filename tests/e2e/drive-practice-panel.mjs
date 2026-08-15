/**
 * End-to-end drive of the in-game practice panel — the two-tab modal that
 * reshapes a *running* match (`src/game/hud/PracticePanel.vue` over
 * `src/game/MatchDirector.ts`).
 *
 * Boots its own Vite dev server, opens the game in system Chrome through
 * Playwright, and reaches the live scene through the DEV-only `window.__lol2d`
 * handle — the same harness as the other `tests/e2e/drive-*.mjs` scripts.
 *
 * ## Why so much of this is dispatched as a real touch
 *
 * `GameScene`'s p5 touch callbacks return `false`, i.e. `preventDefault()` on
 * every touch on the *page* — needed so a drag across the canvas is a control
 * input rather than a scroll. A browser that has had `preventDefault()` called
 * anywhere in a touch gesture synthesises neither the trailing `click` nor its
 * own scrolling, and not just over the canvas: over the DOM HUD sitting on top
 * of it too. Every tab of this panel was built against that, and three separate
 * controls (the CDR slider, the world toggles, the whole loadout editor
 * teleported out of the roster tab) were verifiably dead under a thumb while
 * working perfectly under a mouse. So each control *family* here is driven at
 * least once with a real `Input.dispatchTouchEvent` through CDP — a mouse-only
 * script would have gone green over a feature that did not work on the device
 * this game is mostly played on.
 *
 * ## What it proves, in order
 *
 *   1. the corner button opens a panel with two tabs, and `#practice-close`
 *      closes it from *every* one of them — no tab owns an exit, and the one
 *      that used to (the deleted picker's Huỷ) left the others with no way out
 *      of a modal covering a paused match;
 *   2. Đấu thủ: a bot added while paused is on the roster at once and in
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
 *   9. a kit saved mid-match survives a reload into a new match. Note *where*:
 *      the saved-kit shelf is not on the panel itself — it is at Đấu thủ → a
 *      unit's row → the loadout editor, which teleports out of the panel.
 *      Asserted both ways.
 *
 *   node tests/e2e/drive-practice-panel.mjs [outPrefix]
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-practice-panel';
/** Roomy enough that neither of `styles/hud.css`'s full-bleed media queries applies. */
const VIEWPORT = { width: 1280, height: 900 };
const CFG_KEY = 'lol2d:pregameConfig:v1';
const KITS_KEY = 'lol2d:savedKits:v1';
const KIT_NAME = 'E2E Kit';
const TAB_IDS = ['roster', 'rules'];
const TAB_LABELS = ['Đấu thủ', 'Trận đấu'];

/**
 * A deterministic match. The player is a named champion so the cooldown probe
 * in check 7 has a real spell in slot Q, and `ai.count` is 0 so the only bots
 * in the match are the ones this script adds — a bot rolls a random kit, and
 * every earlier task in this plan that let one into an assertion got an
 * intermittent failure out of it.
 */
const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Ahri',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: true, autoCast: true, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: false },
};

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: VIEWPORT, hasTouch: true });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const cdp = await page.context().newCDPSession(page);
const report = {};
const failures = [];
/** Records a mismatch instead of throwing, so one bad expectation cannot hide the rest of the run. */
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ----------------------------------------------------------------- touch

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

try {
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
    await selectTab(id, id === 'roster'); // one of the two switched by thumb
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

  // ------------------------------------------------- 2. Đấu thủ: add a bot

  await openPanel();
  await selectTab('roster');
  const botsBeforeAdd = await liveBotIds();
  const rosterBeforeAdd = await rosterCount();
  await tapSelector('.practice-add-bot'); // real thumb
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
    'Đấu thủ: a bot added under a thumb is on the roster at once, in the world after one tick',
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
  await tapSelector('.kit-shelf[data-champion="Zed"] .kit-shelf-apply');
  await tapSelector('.kit-bar-btn:not(.secondary)'); // Xác nhận
  await page.waitForTimeout(250);
  const afterSwap = await botSnapshot(botId);
  report.swapChampion = { beforeSwap, afterSwap };
  check(
    "Đấu thủ: swapping a bot's champion changes its name and leaves it standing where it was",
    !!beforeSwap &&
      !!afterSwap &&
      afterSwap.name === 'Zed' &&
      beforeSwap.name !== afterSwap.name &&
      afterSwap.x === beforeSwap.x &&
      afterSwap.y === beforeSwap.y,
    JSON.stringify(report.swapChampion)
  );

  // ------------------------------------------------- 4. behaviour flags

  const flagsBefore = await botSnapshot(botId);
  const FLAGS = `${ROW} .practice-roster-flags .practice-flag`;
  await tapSelector(`${FLAGS}:nth-child(1)`); // "Tự di chuyển", real thumb
  const afterTouchFlag = await botSnapshot(botId);
  await page.click(`${FLAGS}:nth-child(2) input`); // "Tự tấn công", mouse
  await page.waitForTimeout(150);
  const afterMouseFlag = await botSnapshot(botId);
  report.behaviourFlags = { flagsBefore, afterTouchFlag, afterMouseFlag };
  check(
    "Đấu thủ: a behaviour toggle really flips the bot's own flag, under a thumb and under a mouse",
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
    'Đấu thủ: removing a bot marks it at once and the sweep takes it away on the next tick',
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
  for (let press = 0; press < PRESSES; press++) await tapSelector('.practice-add-bot', 30);
  report.cap = {
    AI_COUNT_MAX,
    presses: PRESSES,
    rosterBots: await directorBotCount(),
    inWorldWhilePaused: (await liveBotIds()).length,
    addButtonDisabled: await gameEval(() => document.querySelector('.practice-add-bot').disabled),
    countLabel: await gameEval(
      () => document.querySelector('.practice-add-bot-count')?.textContent.trim() ?? null
    ),
  };
  await page.screenshot({ path: `${OUT}-03-cap.png` });
  check(
    `Đấu thủ: ${PRESSES} presses while paused stop at AI_COUNT_MAX (${AI_COUNT_MAX}), imported not hardcoded`,
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
  const beforeCdr = await gameEval(() => ({
    multiplier: window.__lol2d.scene.oScene.game.matchRules.cooldownMultiplier,
    probeCooldownMs: window.__practiceProbe.effectiveCoolDownMs,
    probeIsStillEquipped:
      window.__practiceProbe === window.__lol2d.scene.oScene.game.player.spells[1],
    label: document.querySelector('#practice-cdr-value')?.textContent ?? null,
  }));
  // A real drag across the track: `RulesTab` computes the percentage from the
  // finger's x, because a range input gets neither the browser's own drag nor a
  // synthetic click once p5 has called preventDefault on the gesture.
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

  // ---------------------------- 9. a kit saved mid-match survives a new match

  await openPanel();
  const shelfOnPanelOpen = await gameEval(
    () => !!document.querySelector('.practice-panel .saved-kit-shelf')
  );
  await selectTab('roster');
  await tapSelector('.practice-roster-row.is-player .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 5_000 });
  const shelfBeforeSaving = await gameEval(() => !!document.querySelector('.saved-kit-shelf'));

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
  await tapSelector('.kit-bar-btn.secondary'); // Huỷ — a save is not a commit
  await page.waitForTimeout(200);
  await closePanel();

  await page.reload({ waitUntil: 'load' });
  await startMatch();
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
  // Field by field rather than a string compare: this asserts that nothing the
  // panel did leaked into the setup screen's stored match, and CDR 90 is the
  // one that would show up if it had.
  const storedRules = JSON.parse(storedConfig ?? 'null');
  report.savedKit = {
    shelfOnPanelOpen,
    shelfBeforeSaving,
    nameFieldFocused,
    storedKitNames: JSON.parse(storedKits ?? '[]').map(kit => kit.name),
    shelfOnPanelOpenAfterReload,
    shelfAfterReload,
    storedPregame: storedRules && {
      championName: storedRules.player?.championName,
      aiCount: storedRules.ai?.count,
      rules: storedRules.rules,
    },
  };
  report.savedKit.pregameConfigUntouched =
    report.savedKit.storedPregame?.championName === MATCH_CONFIG.player.championName &&
    report.savedKit.storedPregame?.aiCount === MATCH_CONFIG.ai.count &&
    report.savedKit.storedPregame?.rules?.cooldownReductionPercent ===
      MATCH_CONFIG.rules.cooldownReductionPercent &&
    report.savedKit.storedPregame?.rules?.manaFree === MATCH_CONFIG.rules.manaFree;
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
    'the shelf lives in the loadout editor off Đấu thủ, never on the panel itself',
    shelfOnPanelOpen === false && shelfOnPanelOpenAfterReload === false,
    `panel before ${shelfOnPanelOpen}, after reload ${shelfOnPanelOpenAfterReload}`
  );
  check(
    'saving a kit does not write through to the pregame config',
    report.savedKit.pregameConfigUntouched === true,
    JSON.stringify(report.savedKit.storedPregame)
  );
} catch (error) {
  failures.push(`threw: ${error.stack ?? error}`);
} finally {
  // Never leave either key behind for the next script in the suite.
  try {
    await page.evaluate(
      keys => keys.forEach(key => localStorage.removeItem(key)),
      [KITS_KEY, CFG_KEY]
    );
    report.storageAfterCleanup = await page.evaluate(
      keys => keys.map(key => localStorage.getItem(key)),
      [KITS_KEY, CFG_KEY]
    );
  } catch (error) {
    failures.push(`cleanup failed: ${error.message}`);
  }

  console.log('\n--- report ---');
  console.log(JSON.stringify(report, null, 2));
  console.log('\n--- page errors ---');
  if (errors.length) for (const error of errors.slice(0, 10)) console.log(error);
  else console.log('(none)');
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
