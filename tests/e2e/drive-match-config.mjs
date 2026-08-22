/**
 * End-to-end drive of the **one** match-config panel, on both surfaces.
 *
 * There used to be two screens answering the same questions with different
 * subsets of the controls — the pregame setup screen over `localStorage` and
 * the in-game practice panel over `MatchDirector`. They are one component now
 * (`MatchConfigPanel`) behind `MatchConfigSource`, and this script exists to
 * prove the thing a unit test structurally cannot: that the *same* markup
 * really does mount and work in both places, in a real browser, against a real
 * running match.
 *
 * `matchConfigSource.contract.test.ts` already asserts the two sources behave
 * identically; what it cannot see is the DOM. So this checks the panel's shape
 * and the handful of interactions whose wiring only exists in the template.
 *
 * What it proves, in order:
 *   1. "Chơi" is still a one-click path into a match — the panel is additive,
 *      never a gate in front of Play;
 *   2. from the menu, the panel opens with all three tabs and the Bắt Đầu
 *      footer, and no console error;
 *   3. the Đội tab out there groups by side, and the side switch moves the
 *      player between Đội Xanh and Đội Đỏ — a control the old setup screen did
 *      not have at all;
 *   4. per-bot AI flags exist out there too — the other half of that gap;
 *   5. Cài đặt carries the input-mode row *and* quality/FPS *and* the debug
 *      layers — the three groups that used to be split across two screens;
 *   6. a cheat switched on before the match starts survives into it, which is
 *      the persistence reversal this change is built on;
 *   7. Bắt Đầu enters the match, and Escape opens the same panel over it, now
 *      showing the live-only controls (KDA, Thoát trận) that hide on the menu;
 *   8. the page going away — backgrounded app, locked phone, switched tab —
 *      pauses the running match and puts that same panel up, and coming back
 *      leaves it paused.
 *
 *   node tests/e2e/drive-match-config.mjs [outPrefix]
 */
import { CFG_KEY, DESKTOP_VIEWPORT, startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/lol2d-match-config';

const { url, page, check, guard } = await startHarness({
  viewport: DESKTOP_VIEWPORT,
});

await guard(async () => {
const shot = name => page.screenshot({ path: `${OUT}-${name}.png` });

const openMenu = async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#play-btn', { timeout: 60_000 });
};

// ---------------------------------------------------------------- 1. menu
await openMenu();
check('menu offers Play without opening the config first', await page.isVisible('#play-btn'));

// ------------------------------------------------- 2. the panel, no match
await page.click('#config-btn');
await page.waitForSelector('#practice-tab-roster', { timeout: 30_000 });

const tabs = await page.$$eval('.practice-tab', nodes => nodes.map(n => n.textContent.trim()));
check(
  'three tabs, in order',
  JSON.stringify(tabs) === JSON.stringify(['Đội', 'Trận đấu', 'Cài đặt']),
  tabs.join(' / ')
);
check('the menu-side panel carries the Bắt Đầu footer', await page.isVisible('#pregame-start-btn'));
check('no live-only exit outside a match', !(await page.isVisible('#practice-exit')));
await shot('menu-roster');

// ------------------------------------------------ 3. sides, from the menu
const teamOf = async () =>
  page.$eval('.practice-roster-row.is-player', row =>
    row.closest('.practice-team').className.includes('--blue') ? 'blue' : 'red'
  );

const before = await teamOf();
await page.click('.practice-roster-row.is-player .practice-team-switch');
const after = await teamOf();
check('the side switch moves the player between the two sides', before !== after, `${before} -> ${after}`);
check(
  'and it persists',
  (await page.evaluate(k => JSON.parse(localStorage.getItem(k)).playerTeam, CFG_KEY)) ===
    (after === 'blue' ? 'team-blue' : 'team-red')
);
// Put it back, so the rest of the run starts from the default side.
await page.click('.practice-roster-row.is-player .practice-team-switch');

// -------------------------------------------- 4. per-bot AI, from the menu
const botRow = '.practice-roster-row:not(.is-player)';
await page.click(`${botRow} .practice-stat-toggle`);
await page.waitForSelector(`${botRow} .practice-cheat-behaviour input`);
const flags = await page.$$eval(`${botRow} .practice-cheat-behaviour input`, n => n.length);
check('a bot exposes its three AI flags outside a match', flags === 3, `${flags} flags`);

/**
 * Which stored slot this row is, read off the DOM rather than assumed to be 0.
 * The roster is grouped by *side*, and the default config alternates bots
 * Red/Blue around a Blue player — so the first bot row in document order is the
 * one on Blue, which is slot 1. Guessing 0 here failed against a perfectly
 * correct panel, which is the sort of thing that gets blamed on the product.
 *
 * The row's DOM id counts from the whole roster, where 0 is the player, so the
 * bot *slot* is one less.
 */
const slot =
  (await page.$eval(`${botRow} .practice-cheat-invuln input`, input =>
    Number(input.id.replace('practice-cheat-invuln-', ''))
  )) - 1;

/**
 * The fourth field of the same per-bot behaviour: how well that bot plays.
 *
 * Both halves of the control are pressed here because only a browser can tell
 * them apart. `GameScene` calls `preventDefault()` on every touch on the page,
 * so a `@click`-only button is perfect under a mouse and completely dead under
 * a thumb — the failure that has shipped repeatedly in this panel, and the one
 * a template scan can only check the *shape* of. `dispatchEvent` rather than
 * `tap()` so the desktop context stays a desktop context.
 */
const difficultyRow = slot + 1;
const storedDifficulty = () =>
  page.evaluate(
    ([k, i]) => JSON.parse(localStorage.getItem(k)).ai.botBehaviours[i].difficulty,
    [CFG_KEY, slot]
  );

check('a bot starts on the default tier', (await storedDifficulty()) === 'normal');
await page.dispatchEvent(`#practice-difficulty-easy-${difficultyRow}`, 'touchend');
check('a touch on the difficulty control reaches the setter', (await storedDifficulty()) === 'easy');
await page.click(`#practice-difficulty-hard-${difficultyRow}`);
check('and so does a click', (await storedDifficulty()) === 'hard');

await page.uncheck(`${botRow} .practice-cheat-behaviour input >> nth=2`);
const storedCast = await page.evaluate(
  ([k, i]) => JSON.parse(localStorage.getItem(k)).ai.botBehaviours[i].autoCast,
  [CFG_KEY, slot]
);
check('un-ticking a per-bot flag persists', storedCast === false, `slot ${slot}`);

// ----------------------------------------- 6. a cheat set before the match
await page.check(`${botRow} .practice-cheat-invuln input`);
const storedInvuln = await page.evaluate(
  ([k, i]) => JSON.parse(localStorage.getItem(k)).cheats.botInvulnerable[i],
  [CFG_KEY, slot]
);
check('invulnerability set before the match is stored', storedInvuln === true, `slot ${slot}`);
check('and the row shows it without the drawer', await page.isVisible(`${botRow} .practice-roster-badge`));

// ------------------------------------------------------- 5. Cài đặt tab
await page.click('#practice-tab-settings');
await page.waitForSelector('#pregame-input-mode-auto');
const settings = await Promise.all([
  page.isVisible('#pregame-input-mode-auto'),
  page.isVisible('#pregame-target-priority-nearest'),
  page.isVisible('#practice-render-quality'),
  page.isVisible('#practice-render-fps'),
  page.isVisible('#practice-debug-routes'),
  page.isVisible('#practice-cheat-reveal-map'),
]);
check('Cài đặt holds controls, targeting, display and the debug layers', settings.every(Boolean), settings.join(','));
check('no camera zoom outside a match', !(await page.isVisible('#practice-zoom')));
await shot('menu-settings');

await page.check('#practice-debug-terrain');
const storedDebug = await page.evaluate(
  k => JSON.parse(localStorage.getItem(k)).cheats.debug.terrain,
  CFG_KEY
);
check('a debug layer lit before the match is stored', storedDebug === true);

// ----------------------- 7. rules, roster size and a real champion pick
//
// The behavioural half of what `drive-pregame-config.mjs` used to prove, kept
// when that script went with the screen it drove. What matters is not that a
// control moves — the contract suite covers that against both sources — but
// that a config edited *with no match running* is the match you get.

await page.click('#practice-tab-rules');
await page.waitForSelector('#practice-cdr');
await page.$eval('#practice-cdr', input => {
  input.value = '90';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.check('#practice-urf');
check('the CDR label reads back what the slider committed', (await page.textContent('#practice-cdr-value')) === '90%');

await page.click('#practice-tab-roster');
// One add button per side, at the end of that side's rows — so pressing Red's
// is how you say "a bot on Red", and the check can assert *where* it landed
// rather than only that the roster grew.
await page.waitForSelector('#practice-add-bot-red');
const botsBefore = await page.$$eval('.practice-roster-row:not(.is-player)', rows => rows.length);
const redBefore = await page.$$eval(
  '.practice-team--red .practice-roster-row',
  rows => rows.length
);
await page.click('#practice-add-bot-red');
await page.waitForFunction(
  n => document.querySelectorAll('.practice-roster-row:not(.is-player)').length === n + 1,
  botsBefore,
  { timeout: 15_000 }
);
const redAfter = await page.$$eval('.practice-team--red .practice-roster-row', rows => rows.length);
check('adding a bot from the menu grows the roster', true, `${botsBefore} -> ${botsBefore + 1}`);
check('and it joins the side whose button was pressed', redAfter === redBefore + 1, `red ${redBefore} -> ${redAfter}`);

// The loadout editor, opened from the row — the same modal in both places, and
// the same draft-until-confirm rule.
await page.click('.practice-roster-row.is-player .practice-roster-open');
await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 15_000 });
await page.click('.kit-shelf[data-champion="Zed"] .kit-shelf-apply');
await page.waitForSelector('.kit-shelf[data-champion="Zed"].open .kit-apply-all', { timeout: 10_000 });
await page.click('.kit-shelf[data-champion="Zed"] .kit-apply-all');

const storedChampion = () =>
  page.evaluate(k => JSON.parse(localStorage.getItem(k)).player.championName, CFG_KEY);
check('a kit picked in the editor is a draft, not yet stored', (await storedChampion()) !== 'Zed');
await page.click('.kit-bar-btn:not(.secondary)'); // Xác nhận
await page.waitForSelector('.loadout-modal', { state: 'detached', timeout: 10_000 });
check('confirming stores it', (await storedChampion()) === 'Zed');

// --------------------------------------------------- 8. into the match
await page.click('#pregame-start-btn');
// `__lol2d` is the SceneManager; the live game hangs off the active scene —
// the same handle `drive-practice-panel.mjs` uses.
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.player, null, {
  timeout: 120_000,
});

// Bots spawn in slot order, so the slot edited above is that index in the
// live roster too — `Game` walks `ai.bots[0..count)` in order.
const applied = await page.evaluate(i => {
  const game = window.__lol2d.scene.oScene.game;
  const bot = game.director.bots()[i];
  return {
    terrain: game.director.debug.terrain,
    botInvulnerable: !!bot && game.director.isInvulnerable(bot),
    botAutoCast: bot ? bot._autoCast : null,
    botDifficulty: bot ? bot._difficulty : null,
  };
}, slot);
check('the debug layer set on the menu is on in the match', applied.terrain === true);
check('the bot configured invulnerable spawns invulnerable', applied.botInvulnerable === true);
check('the bot configured not to cast spawns not casting', applied.botAutoCast === false);
check(
  'the tier chosen on the menu is the tier that spawns',
  applied.botDifficulty === 'hard',
  applied.botDifficulty
);

const match = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  return {
    player: game.player.name,
    bots: game.director.bots().length,
    cooldownMultiplier: game.matchRules.cooldownMultiplier,
    manaFree: game.matchRules.manaFree,
    playerQCooldownMs: game.player.spells[1]?.effectiveCoolDownMs ?? null,
    playerQManaCost: game.player.spells[1]?.effectiveManaCost ?? null,
  };
});
check('the champion picked on the menu is the one that spawns', match.player === 'Zed', match.player);
check('the bot added on the menu is in the match', match.bots === botsBefore + 1, `${match.bots} bots`);
// The rules are not just stored — they reach a real spell on a real champion.
// A tolerance, not `=== 0.1`: the multiplier is `1 - 90/100`, which in binary
// floating point is 0.09999999999999998.
check(
  '90% CDR reaches the spells that spawned',
  Math.abs(match.cooldownMultiplier - 0.1) < 1e-9 && match.playerQCooldownMs !== null,
  JSON.stringify(match)
);
check('URF makes that spell free', match.manaFree === true && match.playerQManaCost === 0, `${match.playerQManaCost}`);

// Escape opens the same panel over the running match.
await page.keyboard.press('Escape');
await page.waitForSelector('#practice-tab-roster', { timeout: 15_000 });
check('the same panel opens over the match', await page.isVisible('#practice-tab-roster'));
check('and no Bắt Đầu footer', !(await page.isVisible('#pregame-start-btn')));

// The panel reopens on whichever tab was last selected — deliberately, and it
// survives the scene change (see `panelTab.ts`), so the live-only controls have
// to be looked for on their own tabs rather than wherever it happens to land.
await page.click('#practice-tab-roster');
await page.waitForSelector('.practice-roster-row');
check('a KDA readout appears only in a match', await page.isVisible('.practice-score'));
await shot('match-roster');

// A kit icon opens that ability's description. It used to do this only on the
// setup screen; in the panel the same icons were decorative, which is one of
// the divergences the single panel removes.
await page.click('.practice-roster-row.is-player .practice-roster-spell >> nth=0');
await page.waitForSelector('.spell-preview-modal', { timeout: 5_000 });
check(
  'a kit icon opens the ability description inside a match',
  await page.isVisible('.spell-preview-modal')
);
await page.click('.spell-preview-modal .pregame-icon-btn');
await page.waitForSelector('.spell-preview-modal', { state: 'detached', timeout: 5_000 });

await page.click('#practice-tab-rules');
await page.waitForSelector('#practice-cdr');
check('the match tab carries the live-only exit', await page.isVisible('#practice-exit'));
check('and no "Về menu" in its place', !(await page.isVisible('#pregame-back-btn')));

await page.click('#practice-tab-settings');
await page.waitForSelector('#practice-zoom');
check('the zoom slider appears only in a match', await page.isVisible('#practice-zoom'));
check('and the input-mode row is reachable mid-match', await page.isVisible('#pregame-input-mode-auto'));
await shot('match-settings');

// ------------------------------------------ 9. the player leaves the page
//
// A backgrounded PWA used to keep simulating: minions pushed, bots fought, and
// the player came back to a match that had moved on without them. The fix is
// one path — `visibilitychange` -> `GameScene` -> `Game.pauseForAway` -> the
// HUD's own `openSpellPicker` — and a unit test can see each link but not that
// they are joined, so the event is dispatched for real here.
//
// Everything below runs on the match this script has already built, which is
// the point: `Game.paused` is read off the live game, not inferred from the
// panel being on screen.

const panelUp = '#practice-tab-roster';
const matchState = () =>
  page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return { paused: game.paused, panel: !!game.inGameHUD.vueInstance.hud.showSpellsPicker };
  });

await page.keyboard.press('Escape');
await page.waitForSelector(panelUp, { state: 'detached', timeout: 15_000 });
const running = await matchState();
check(
  'closing the panel puts the match back on the clock',
  !running.paused && !running.panel,
  JSON.stringify(running)
);

// `document.hidden` is an accessor on Document.prototype; an own configurable
// property shadows it, which is the only way to make a real browser report
// itself hidden without actually backgrounding the window.
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForSelector(panelUp, { timeout: 15_000 });
const away = await matchState();
check(
  'the page going away pauses the match and opens the panel',
  away.paused && away.panel,
  JSON.stringify(away)
);
await shot('match-away');

// Coming back must *not* undo it. A match that resumes itself the instant the
// screen lights up is the same bug pointed the other way — the player resumes
// deliberately, from the panel that is already in front of them.
await page.evaluate(() => {
  delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(500);
const returned = await matchState();
check(
  'coming back leaves it paused, with the panel still up',
  returned.paused && returned.panel,
  JSON.stringify(returned)
);

// And the deliberate resume still works, which is what proves the runtime was
// held rather than broken.
await page.click('#practice-close');
await page.waitForSelector(panelUp, { state: 'detached', timeout: 15_000 });
await page.waitForTimeout(500);
const resumed = await matchState();
check(
  'and the player can resume it from that panel',
  !resumed.paused && !resumed.panel,
  JSON.stringify(resumed)
);
});
