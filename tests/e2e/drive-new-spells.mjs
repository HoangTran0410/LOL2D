/**
 * Visual verification for the four new spells added in this branch:
 * Malphite E (Ground Slam), Anivia E (Frostbite), Janna W (Zephyr), and
 * Janna E (Eye of the Storm). Drives the real game through the DEV-only
 * `window.__lol2d` handle the same way drive-game.mjs and
 * drive-attached-effects.mjs do, force-casting each spell on the player and
 * screenshotting the result.
 *
 *   node tests/e2e/drive-new-spells.mjs /tmp/lol2d-new-spells
 *
 * Boots its own Vite dev server on a random port unless LOL2D_URL is set.
 * Requires a system Chrome install.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-new-spells';
const PORT = process.env.LOL2D_PORT ?? String(5_800 + Math.floor(Math.random() * 400));
const URL = process.env.LOL2D_URL ?? `http://localhost:${PORT}/`;
const OWN_SERVER = !process.env.LOL2D_URL;
const CANARY = 'packs/riot/spells/Malphite_E.ts';

let server;
let serverLog = '';
if (OWN_SERVER) {
  server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => (serverLog += data));
  server.stderr.on('data', data => (serverLog += data));
  server.on('exit', code => {
    if (code) serverLog += `\nvite exited with ${code}`;
  });
}

const shutdown = async browser => {
  await browser?.close();
  server?.kill('SIGTERM');
};
process.on('exit', () => server?.kill('SIGTERM'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server?.kill('SIGTERM');
    process.exit(1);
  });
}

{
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new global.URL(CANARY, URL));
      const body = await response.text();
      if (response.ok && !body.includes('<!DOCTYPE html>')) {
        ready = true;
        break;
      }
    } catch {
      // server not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) {
    await shutdown();
    throw new Error(`No dev server serving this checkout at ${URL}.\n${serverLog}`);
  }
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(
  () => window.__lol2d?.scene?.oScene?.game?.objectManager,
  null,
  { timeout: 30_000 }
);
await page.waitForTimeout(1_500);

await page.evaluate(() => {
  const camera = window.__lol2d.scene.oScene.game.camera;
  camera.scale = 2.4;
  camera.currentScale = 2.4;
});

// Spawn two stationary dummies (enemy + ally) beside the player and clear
// away every AI-controlled unit, so the screenshots show only the spell
// effect this run is exercising rather than a live 5v5 skirmish.
const setup = await page.evaluate(async () => {
  const { default: DummyChampion } = await import(
    '/src/game/gameObject/attackableUnits/DummyChampion.ts'
  );
  const { default: TeamId } = await import('/src/game/enums/TeamId.ts');
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  champion.stats.mana.baseValue = champion.stats.maxMana.value;
  champion.stats.health.baseValue = champion.stats.maxHealth.value;

  // Full arena wipe: every AI bot keeps auto-casting on its own clock
  // (_autoCast defaults true), so relocating a bot does not stop whatever
  // spell object it already created from lingering near the player. Remove
  // every object outright except the player and structures/terrain, which
  // is more reliable than only teleporting units away.
  for (const o of game.objectManager.objects) {
    if (o === champion) continue;
    const name = o.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    o.toRemove = true;
  }
  game.objectManager.update();
  // drop any lingering debuff (a DoT, a slow) the player picked up before this ran
  for (const buff of champion.buffs) buff.deactivateBuff();
  champion.updateBuffs();
  champion.stats.health.baseValue = champion.stats.maxHealth.value;
  champion.stats.mana.baseValue = champion.stats.maxMana.value;

  const enemyTeam = champion.teamId === TeamId.BLUE ? TeamId.RED : TeamId.BLUE;
  const enemy = new DummyChampion({
    game,
    position: window.createVector(champion.position.x + 140, champion.position.y),
    preset: { name: 'Enemy Dummy', spells: [] },
  });
  enemy.teamId = enemyTeam;
  enemy.stats.health.baseValue = enemy.stats.maxHealth.baseValue = 100;
  enemy.stats.mana.baseValue = enemy.stats.maxMana.baseValue = 100;
  game.objectManager.addObject(enemy);

  const ally = new DummyChampion({
    game,
    position: window.createVector(champion.position.x - 140, champion.position.y - 100),
    preset: { name: 'Ally Dummy', spells: [] },
  });
  ally.teamId = champion.teamId;
  ally.stats.health.baseValue = ally.stats.maxHealth.baseValue = 100;
  ally.stats.mana.baseValue = ally.stats.maxMana.baseValue = 100;
  game.objectManager.addObject(ally);

  game.objectManager.update(); // settle both dummies into the world + quadtree

  window.__e2eEnemy = enemy;
  window.__e2eAlly = ally;

  return {
    championAt: { x: Math.round(champion.position.x), y: Math.round(champion.position.y) },
    enemyAt: { x: Math.round(enemy.position.x), y: Math.round(enemy.position.y) },
    allyAt: { x: Math.round(ally.position.x), y: Math.round(ally.position.y) },
  };
});

const castOn = (spellModule, spellClass, targetHandle) =>
  page.evaluate(async ({ spellModule, spellClass, targetHandle }) => {
    // Every pack spell's export is a factory now (batch 4 task 3), resolved
    // against the cached ContentApi singleton spellRegistry.ts itself builds
    // against.
    const { buildContentApi } = await import('/src/content/ContentApi.ts');
    const api = buildContentApi();
    const mod = await import(spellModule);
    const SpellClass = mod[spellClass](api);
    const game = window.__lol2d.scene.oScene.game;
    const champion = game.player;
    const target = targetHandle ? window[targetHandle] : champion;
    const spell = new SpellClass(champion);
    // Champion.update() is what calls spell.update() every frame, driving a
    // cast past its windup (castTimeMs) to the point it actually creates its
    // effect object. A spell built standalone here is not in champion.spells
    // and would sit frozen in CASTING forever without this.
    champion.spells.push(spell);
    const origin = { x: champion.position.x, y: champion.position.y };
    const cursorWorld = { x: target.position.x, y: target.position.y };
    const dx = cursorWorld.x - origin.x;
    const dy = cursorWorld.y - origin.y;
    const length = Math.hypot(dx, dy) || 1;
    const context = Object.freeze({
      spellId: `e2e-${spellClass}`,
      activationId: 'e2e',
      startedAtMs: Date.now(),
      caster: champion,
      origin: Object.freeze(origin),
      cursorWorld: Object.freeze(cursorWorld),
      direction: Object.freeze({ x: dx / length, y: dy / length }),
      ...(targetHandle ? { target } : {}),
    });
    const accepted = spell.press(context);
    return {
      accepted,
      state: spell.state,
      diag: {
        isDead: champion.isDead,
        canCast: champion.canCast,
        mana: champion.stats.mana.value,
        manaCost: spell.manaCost,
        health: champion.stats.health.value,
        healthCost: spell.healthCost,
        disabled: spell.disabled,
        checkCastCondition: spell.checkCastCondition(),
      },
    };
  }, { spellModule, spellClass, targetHandle });

const results = {};

// ---- Malphite E: Ground Slam ------------------------------------------
results.malphiteE = await castOn(
  '/packs/riot/spells/Malphite_E.ts', 'default', undefined
);
// CAST_TIME_MS is 250ms before the slam object even exists, and it fades out
// over FADE_MS=450ms after that — the window to actually see it is ~250-700ms
// after press(), not right after it.
await page.waitForTimeout(340);
await page.screenshot({ path: `${OUT}-1-malphite-e-slam.png` });
await page.waitForTimeout(220);
await page.screenshot({ path: `${OUT}-1b-malphite-e-fading.png` });

// ---- Anivia E: Frostbite, undoubled then doubled -----------------------
results.aniviaE_plain = await castOn(
  '/packs/riot/spells/Anivia_E.ts', 'default', '__e2eEnemy'
);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}-2-anivia-e-plain.png` });

const chillInfo = await page.evaluate(async () => {
  const { default: Chilled } = await import('/src/game/gameObject/buffs/Chilled.ts');
  const game = window.__lol2d.scene.oScene.game;
  const enemy = window.__e2eEnemy;
  enemy.addBuff(new Chilled(3_000, game.player, enemy));
  return { chilled: enemy.hasBuff(Chilled), health: enemy.stats.health.value };
});
results.aniviaE_chillApplied = chillInfo;

results.aniviaE_doubled = await castOn(
  '/packs/riot/spells/Anivia_E.ts', 'default', '__e2eEnemy'
);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}-3-anivia-e-chilled-doubled.png` });

// ---- Janna W: Zephyr (passive + active bolt) ----------------------------
const passiveBefore = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { default: makeJanna_W, makeJanna_W_Passive } = await import(
    '/packs/riot/spells/Janna_W.ts'
  );
  const Janna_W = makeJanna_W(api);
  const Janna_W_Passive = makeJanna_W_Passive(api);
  const { default: StatusFlags } = await import('/src/game/enums/StatusFlags.ts');
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  const spell = new Janna_W(champion);
  window.__e2eJannaW = spell;
  const baseSpeed = champion.stats.speed.value;
  spell.onUpdate();
  // status flags are aggregated from buffs during updateBuffs(), which the
  // real game loop runs every frame via champion.update() — recompute it here
  // rather than waiting a frame, so this check is not a race.
  champion.updateBuffs();
  return {
    hasPassive: champion.hasBuff(Janna_W_Passive),
    ghosted: Boolean(champion.status & StatusFlags.Ghosted),
    baseSpeed,
    boostedSpeed: champion.stats.speed.value,
  };
});
results.jannaW_passive = passiveBefore;
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-4-janna-w-passive-ghosted.png` });

results.jannaW_bolt = await castOn(
  '/packs/riot/spells/Janna_W.ts', 'default', '__e2eEnemy'
);
// same 250ms castTimeMs windup as Malphite E before the bolt object exists
await page.waitForTimeout(320);
await page.screenshot({ path: `${OUT}-5-janna-w-bolt-flight.png` });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}-5b-janna-w-bolt-impact.png` });

// ---- Janna E: Eye of the Storm (shield shell on an ally) ----------------
results.jannaE = await castOn(
  '/packs/riot/spells/Janna_E.ts', 'default', '__e2eAlly'
);
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}-6-janna-e-shield.png` });

const jannaEState = await page.evaluate(async () => {
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeJanna_E_Shell } = await import('/packs/riot/spells/Janna_E.ts');
  const Janna_E_Shell = makeJanna_E_Shell(api);
  const { default: Shield } = await import('/src/game/gameObject/buffs/Shield.ts');
  const game = window.__lol2d.scene.oScene.game;
  const ally = window.__e2eAlly;
  const shell = game.objectManager.objects.find(o => o instanceof Janna_E_Shell);
  return {
    shellFound: Boolean(shell),
    shieldOnAlly: ally.buffs.some(b => b instanceof Shield),
  };
});
results.jannaE_state = jannaEState;

// move the shielded ally away and confirm the shell follows, not the caster
await page.evaluate(() => {
  const ally = window.__e2eAlly;
  ally.teleportTo(ally.position.x + 260, ally.position.y - 40);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-7-janna-e-shield-follows-ally.png` });

const fps = await page.evaluate(() => Math.round(window.frameRate?.() ?? -1));
console.log(JSON.stringify({ setup, results, fps, errors }, null, 2));

await browser.close();
server?.kill('SIGTERM');

const failures = [];
if (!results.malphiteE.accepted) failures.push('Malphite E was not accepted');
if (!results.aniviaE_plain.accepted) failures.push('Anivia E (plain) was not accepted');
if (!results.aniviaE_chillApplied.chilled) failures.push('Chilled mark was not applied for the doubled-damage check');
if (!results.aniviaE_doubled.accepted) failures.push('Anivia E (chilled) was not accepted');
if (!results.jannaW_passive.hasPassive) failures.push('Janna W passive buff was not applied');
if (!results.jannaW_passive.ghosted) failures.push('Janna W passive did not set the Ghosted status flag');
if (results.jannaW_passive.boostedSpeed <= results.jannaW_passive.baseSpeed) failures.push('Janna W passive did not increase movement speed');
if (!results.jannaW_bolt.accepted) failures.push('Janna W bolt was not accepted');
if (!results.jannaE.accepted) failures.push('Janna E was not accepted');
if (!results.jannaE_state.shellFound) failures.push('Janna E shield shell object was not found');
if (!results.jannaE_state.shieldOnAlly) failures.push('Janna E did not shield the targeted ally');
if (errors.length) failures.push(...errors);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
