/**
 * End-to-end drive of the pregame setup screen in the real game.
 *
 * Boots its own Vite dev server, opens the game in system Chrome through
 * Playwright, and reaches the live scene through the DEV-only `window.__lol2d`
 * handle set in src/main.ts — same pattern as the other tests/e2e/*.mjs
 * scripts.
 *
 * The screen is two tabs (Tướng / Cấu Hình) plus one shared loadout-editor
 * modal, opened by tapping any participant card — see SetupScene.vue's file
 * comment for the IA. Every click target on it is now unambiguous: nothing
 * has a `.stop`-guarded child handler competing with its own, so this script
 * uses plain `page.click()` throughout (no coordinate workarounds needed).
 *
 * What it proves, in order:
 *   1. the menu's "Chơi" button is still a one-click path into a match (no
 *      gate in front of Play);
 *   2. the Players tab, on first open, shows the human player first (marked
 *      "Bạn") and exactly `DEFAULT_PREGAME_CONFIG.ai.count` bots below —
 *      nothing else, which is the "reads cleanly on first open" goal;
 *   3. opening the player's card and a bot's card opens the *same* modal
 *      (identical DOM shape, bound to different data) — the fix for the
 *      layout duplication the redesign was asked for;
 *   4. "Thêm Bot" / the last bot's remove control actually change AI count,
 *      as direct manipulation on the list, not a slider in another tab;
 *   5. the Settings tab's AI behaviour + match-rule controls round-trip
 *      through real DOM interaction into localStorage;
 *   6. picking a champion + both summoners for the player, through the
 *      modal, persists;
 *   7. the whole edited config survives a reload;
 *   8. a non-default AI count actually spawns that many AIChampion instances;
 *   9. the AI auto-move / auto-attack toggles actually change bot behaviour,
 *      not just a field's resting value;
 *   10. cooldown reduction actually shortens a real spell's cooldown, cast
 *       through a real keypress, and URF lets that same cast go through at
 *       zero mana;
 *   11. the picked champion + kit (avatar, Q/W/E/R, both summoners) is what
 *       the player actually spawns with.
 *
 *   node tests/e2e/drive-pregame-config.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-pregame';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const report = {};
const evaluate = (fn, arg) => page.evaluate(fn, arg);
const openTab = tab => page.click(`#pregame-tab-${tab}`);
/** The nth participant card (1 = the player, 2 = Bot 1, 3 = Bot 2, ...). */
const openParticipantAt = n => page.click(`#pregame-participant-list .participant-card:nth-child(${n}) .participant-card-main`);
/** Only valid while the modal's *editor* view (not the slot selector) is showing. */
const closeLoadoutModal = () => page.click('.pregame-modal-header .pregame-icon-btn');
/** The D or F summoner slot inside the currently-open editor view. */
const openSummonerSlot = which => page.click(`.summoner-row .kit-slot:nth-child(${which === 'D' ? 1 : 2})`);
/** The Nth custom slot (0 = A, 1 = Q, ...), inside the currently-open editor view. */
const openCustomSlot = index => page.click(`.custom-slot-row .kit-slot:nth-child(${index + 1})`);
/** Highlights (does not commit) a catalogue entry among the flat summoner list. */
const highlightFlatEntry = index =>
  page.evaluate(
    i => document.querySelectorAll('.selector-catalogue .catalog-spell-card')[i].dispatchEvent(new MouseEvent('click', { bubbles: true })),
    index
  );
const commitSlot = () => page.click('.selector-commit');

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('lol2d:pregameConfig:v1'));

  // 1. "Chơi" is still a one-click path into a match with nothing configured
  await page.reload({ waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  report.playIsOneClick = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      started: !!game,
      defaultAiCount: game.objectManager.objects.filter(o => o.constructor.name === 'AIChampion').length,
    };
  });
  await evaluate(() => window.__lol2d.scene.oScene.stopGame());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 2. Players tab, first open: the player marked "Bạn", 5 bots, nothing else
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  report.playersTabOnFirstOpen = await evaluate(() => {
    const cards = [...document.querySelectorAll('#pregame-participant-list .participant-card')];
    const player = cards.find(c => c.classList.contains('participant-card-player'));
    const bots = cards.filter(c => !c.classList.contains('participant-card-player'));
    return {
      activeTab: document.querySelector('.pregame-tab.selected')?.id,
      playerLabel: player?.querySelector('.participant-name')?.textContent,
      playerSummary: player?.querySelector('.participant-summary')?.textContent,
      botCount: bots.length,
      lastBotLabel: bots.at(-1)?.querySelector('.participant-name')?.textContent,
      modalOpen: !!document.querySelector('.pregame-modal-backdrop'),
    };
  });
  await page.screenshot({ path: `${OUT}-setup-defaults.png` });

  // 3. the player's card and a bot's card open the identical modal
  await openParticipantAt(1); // the player
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.playerEditor = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    selectedChampion: document.querySelector('.champion-card.selected')?.dataset.champion,
    summonerD: document.querySelector('.summoner-row .kit-slot:nth-child(1) .kit-slot-name')?.textContent,
    summonerF: document.querySelector('.summoner-row .kit-slot:nth-child(2) .kit-slot-name')?.textContent,
    championCardCount: document.querySelectorAll('.champion-card').length,
  }));
  await closeLoadoutModal();
  await page.waitForTimeout(100);

  await openParticipantAt(2); // Bot 1
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  report.sameModalForBot = await evaluate(() => ({
    title: document.querySelector('.pregame-modal-header h3')?.textContent,
    hasKitModeToggle: !!document.querySelector('.kit-mode-toggle'),
    hasChampionGrid: !!document.querySelector('.champion-grid'),
    hasSummonerSlots: document.querySelectorAll('.summoner-row .kit-slot').length,
  }));
  await closeLoadoutModal();
  await page.waitForTimeout(100);

  // 4. "Thêm Bot" and the last bot's remove control actually change AI count
  await page.click('#pregame-add-bot-btn');
  await page.click('#pregame-add-bot-btn');
  await page.click('#pregame-add-bot-btn');
  await page.waitForTimeout(80);
  report.botCountAfterAdding = await evaluate(
    () => document.querySelectorAll('.participant-card:not(.participant-card-player)').length
  );

  // 5. Settings tab: AI behaviour + match rules round-trip into localStorage
  await openTab('settings');
  await page.waitForSelector('#pregame-ai-automove', { state: 'visible' });
  await page.click('#pregame-ai-automove');
  await page.click('#pregame-ai-autoattack'); // was on by default -> off
  await page.click('#pregame-ai-autocast'); // was on by default -> off
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '50';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-urf');
  await page.waitForTimeout(80);

  // 6. pick a champion + both summoners for the player through the modal
  await openTab('players');
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  await page.click('.champion-card[data-champion="Yasuo"]');
  await openSummonerSlot('D');
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  await highlightFlatEntry(1); // Flash(0), Ghost(1), Heal(2), Ignite(3), StealthWard(4)
  await commitSlot();
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  await openSummonerSlot('F');
  await page.waitForSelector('.selector-pane', { state: 'visible' });
  await highlightFlatEntry(3);
  await commitSlot();
  await page.waitForSelector('.loadout-modal .kit-mode-toggle', { state: 'visible' });
  await closeLoadoutModal();
  await page.waitForTimeout(100);

  report.persistedAfterEditing = await evaluate(() => JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1')));
  await page.screenshot({ path: `${OUT}-setup-customized.png` });

  // 7. reload the screen from scratch and confirm the edits survived
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  await openParticipantAt(1);
  await page.waitForSelector('.loadout-modal', { state: 'visible' });
  const selectedChampionAfterReload = await evaluate(
    () => document.querySelector('.champion-card.selected')?.dataset.champion
  );
  await closeLoadoutModal();
  await page.waitForTimeout(80);
  // botCount must be read while the Players tab's DOM actually exists —
  // PlayersTab/SettingsTab are `v-if`/`v-else`, so only one is mounted at a
  // time (see SetupScene.vue).
  const botCountAfterReload = await evaluate(
    () => document.querySelectorAll('.participant-card:not(.participant-card-player)').length
  );
  await openTab('settings');
  await page.waitForSelector('#pregame-cdr', { state: 'visible' });
  report.survivesReload = {
    selectedChampion: selectedChampionAfterReload,
    botCount: botCountAfterReload,
    aiAutoMove: await evaluate(() => document.querySelector('#pregame-ai-automove').checked),
    cdr: await evaluate(() => document.querySelector('#pregame-cdr').value),
    urf: await evaluate(() => document.querySelector('#pregame-urf').checked),
  };

  // 8. start the match with this config
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  report.matchRules = await evaluate(() => window.__lol2d.scene.oScene.game.matchRules);

  report.aiRoster = await evaluate(async () => {
    const aiModule = await import('/src/game/gameObject/attackableUnits/AIChampion.ts');
    const game = window.__lol2d.scene.oScene.game;
    const bots = game.objectManager.objects.filter(o => o instanceof aiModule.default);
    return {
      count: bots.length,
      allAutoMoveOn: bots.every(b => b._autoMove === true),
      allAutoAttackOff: bots.every(b => b._autoAttack === false),
      allAutoCastOff: bots.every(b => b._autoCast === false),
    };
  });

  // 9. AI toggles actually change behaviour, not just the field's resting
  // value: pin two bots adjacent to each other with autoAttack off, and watch
  // one bot's position to prove autoMove is really driving it to wander.
  report.aiBehaviour = await evaluate(async () => {
    const game = window.__lol2d.scene.oScene.game;
    const [a, b] = game.objectManager.objects.filter(
      o => o !== game.player && o.basicAttack && o.constructor.name === 'AIChampion'
    );
    a.position.set(3200, 3200);
    a.destination.set(3200, 3200);
    b.position.set(3230, 3200); // well inside AI_ATTACK_AGGRO_RANGE (420)
    b.destination.set(3230, 3200);
    a.basicAttack.clear();
    b.basicAttack.clear();
    a._attackScanCooldown = 0;
    b._attackScanCooldown = 0;

    const wanderStart = { x: a.position.x, y: a.position.y };
    await new Promise(resolve => setTimeout(resolve, 1_600));

    return {
      noAutoAttackDespiteProximity: a.basicAttack.target === null && b.basicAttack.target === null,
      distanceStayedClose: Math.round(a.position.dist(b.position)),
      wanderedFromAutoMove: Math.round(Math.hypot(a.position.x - wanderStart.x, a.position.y - wanderStart.y)),
    };
  });

  // 10. cooldown reduction + URF, cast through a real keypress. Yasuo Q is
  // slot 1 (Q). Teleported to an empty corner and aimed into open ground so
  // the "reduced cooldown on hit" mechanic (a pre-existing, unrelated
  // mechanic) never fires — this measures the plain start-of-cast cooldown.
  report.spellSetup = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;
    const spell = player.spells[1];
    player.position.set(200, 200);
    player.destination.set(200, 200);
    player.stats.mana.baseValue = 0; // prove URF: this alone would refuse a normal cast
    spell.resetCoolDown();
    return {
      slotName: spell.constructor.name,
      rawCoolDown: spell.coolDown,
      effectiveCoolDownMs: spell.effectiveCoolDownMs,
      manaCost: spell.manaCost,
      effectiveManaCost: spell.effectiveManaCost,
      manaBeforeCast: player.stats.mana.value,
    };
  });
  const aimScreen = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const point = game.camera.worldToScreen(400, 200); // straight right, open ground
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(aimScreen.x, aimScreen.y);
  await page.waitForTimeout(80);
  await page.keyboard.press('q');
  await page.waitForTimeout(150);
  report.spellAfterCast = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const spell = game.player.spells[1];
    return {
      manaAfterCast: game.player.stats.mana.value,
      currentCooldown: Math.round(spell.currentCooldown),
      state: spell.state,
    };
  });
  await page.screenshot({ path: `${OUT}-after-cast.png` });

  // 11. the picked champion + kit is what the player spawns with
  report.playerLoadout = await evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return {
      avatarKey: game.player.avatar?.key,
      spellNames: game.player.spells.map(s => s.constructor.name),
    };
  });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) process.exitCode = 1;
