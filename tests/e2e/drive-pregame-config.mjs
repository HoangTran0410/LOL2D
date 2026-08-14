/**
 * End-to-end drive of the pregame setup screen in the real game.
 *
 * Boots its own Vite dev server, opens the game in system Chrome through
 * Playwright, and reaches the live scene through the DEV-only `window.__lol2d`
 * handle set in src/main.ts — same pattern as the other tests/e2e/*.mjs
 * scripts.
 *
 * What it proves, in order:
 *   1. the menu's "Chơi" button is still a one-click path into a match (no
 *      gate in front of Play);
 *   2. opening the setup screen with nothing saved shows exactly the
 *      defaults (DEFAULT_PREGAME_CONFIG), and its controls round-trip
 *      through real DOM interaction into localStorage;
 *   3. a non-default AI count actually spawns that many AIChampion instances;
 *   4. the AI auto-move / auto-attack toggles actually change bot behaviour,
 *      not just a field's resting value;
 *   5. cooldown reduction actually shortens a real spell's cooldown, cast
 *      through a real keypress;
 *   6. URF actually lets that same cast go through at zero mana;
 *   7. the picked champion + kit (avatar, Q/W/E/R, both summoners) is what
 *      the player actually spawns with.
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
/** Dispatches a click directly on the matched element, bypassing Playwright's
 * coordinate-based hit test — needed wherever a clickable element is mostly
 * filled by a child that has its own (`stopPropagation`d) click handler. */
const clickButton = selector =>
  page.evaluate(sel => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true })), selector);

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
      defaultAiCount: game.objectManager.objects.filter(
        o => o.constructor.name === 'AIChampion'
      ).length,
    };
  });
  await evaluate(() => window.__lol2d.scene.oScene.stopGame());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 2. the setup screen with nothing saved shows exactly the defaults
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  report.defaultsOnFirstOpen = await evaluate(() => ({
    selectedChampion: document.querySelector('.champion-card.selected')?.dataset.champion,
    selectedSummonerD: document
      .querySelector('.summoner-slot-d .summoner-option.selected')
      ?.dataset.summoner,
    selectedSummonerF: document
      .querySelector('.summoner-slot-f .summoner-option.selected')
      ?.dataset.summoner,
    aiCount: document.querySelector('#pregame-ai-count').value,
    aiAutoMove: document.querySelector('#pregame-ai-automove').checked,
    aiAutoAttack: document.querySelector('#pregame-ai-autoattack').checked,
    aiAutoCast: document.querySelector('#pregame-ai-autocast').checked,
    cdr: document.querySelector('#pregame-cdr').value,
    urf: document.querySelector('#pregame-urf').checked,
    championCardCount: document.querySelectorAll('.champion-card').length,
  }));
  await page.screenshot({ path: `${OUT}-setup-defaults.png` });

  // 3. drive real DOM controls: 8 AI bots, auto-move ON, auto-attack/auto-cast
  // OFF, 50% cooldown reduction, URF on, Yasuo with Ghost/Ignite.
  await evaluate(() => {
    const range = document.querySelector('#pregame-ai-count');
    range.value = '8';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-ai-automove');
  await page.click('#pregame-ai-autoattack'); // was on by default -> off
  await page.click('#pregame-ai-autocast'); // was on by default -> off
  await evaluate(() => {
    const range = document.querySelector('#pregame-cdr');
    range.value = '50';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#pregame-urf');
  await page.click('.champion-card[data-champion="Yasuo"]');
  // A summoner option is just its 32x32 icon plus 2px of padding, so a
  // coordinate-based click (page.click's default) always lands on the <img>
  // and previews instead of picking — same as tapping any other spell icon.
  // Dispatching the click on the <button> itself (as clickCatalogSpell()
  // does for the same reason in drive-kit-builder.mjs) picks it instead.
  await clickButton('.summoner-slot-d .summoner-option[data-summoner="Ghost"]');
  await clickButton('.summoner-slot-f .summoner-option[data-summoner="Ignite"]');
  await page.waitForTimeout(100);

  report.persistedAfterEditing = await evaluate(() =>
    JSON.parse(localStorage.getItem('lol2d:pregameConfig:v1'))
  );
  await page.screenshot({ path: `${OUT}-setup-customized.png` });

  // reload the screen from scratch and confirm the edits survived — the
  // "persist so it survives a reload" requirement, exercised for real
  await page.reload({ waitUntil: 'load' });
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.waitForTimeout(150);
  report.survivesReload = await evaluate(() => ({
    selectedChampion: document.querySelector('.champion-card.selected')?.dataset.champion,
    aiCount: document.querySelector('#pregame-ai-count').value,
    aiAutoMove: document.querySelector('#pregame-ai-automove').checked,
    cdr: document.querySelector('#pregame-cdr').value,
    urf: document.querySelector('#pregame-urf').checked,
  }));

  // 4. start the match with this config
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

  // 5. AI toggles actually change behaviour, not just the field's resting
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
      wanderedFromAutoMove: Math.round(
        Math.hypot(a.position.x - wanderStart.x, a.position.y - wanderStart.y)
      ),
    };
  });

  // 6. cooldown reduction + URF, cast through a real keypress. Yasuo Q is
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

  // 7. the picked champion + kit is what the player spawns with
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
