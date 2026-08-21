/**
 * End-to-end proof that a caster-centred ability still reaches once the caster
 * has been grown by Cho'Gath's ultimate, driving the real game in Chrome.
 *
 * The setup is the one the bug needs: grow the champion to MAX_UNIT_SIZE, park
 * an enemy right next to it and let a few real frames of `UnitCollisionSystem`
 * push the two apart to wherever separation actually holds them. Then cast Lee
 * Sin R and see whether it finds anybody.
 *
 * Each case reports two numbers side by side — what the spell's own query
 * returns now, and what the raw authored range would have returned, which is
 * what `main` does — so the before and the after come out of the same run.
 *
 *   node tests/e2e/drive-size-aware-range.mjs            # boots its own server
 *   node tests/e2e/drive-size-aware-range.mjs /tmp/reach # screenshot prefix
 *
 * Set LOL2D_URL to point at a dev server you already have running.
 * Requires a system Chrome install.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-reach';
const PORT = process.env.LOL2D_PORT ?? String(5_200 + Math.floor(Math.random() * 600));
const URL = process.env.LOL2D_URL ?? `http://localhost:${PORT}/`;
const OWN_SERVER = !process.env.LOL2D_URL;
// proof that the server on this port is serving THIS checkout, not a stale one
const CANARY = 'src/game/combat/Reach.ts';

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
    throw new Error(
      `No dev server serving this checkout at ${URL} (looked for ${CANARY}).\n${serverLog}`
    );
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
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_500);

// ------------------------------------------------------------------- setup
//
// Clear the field, put a lone enemy on the player's doorstep, and zoom in so
// the two bodies and the ability's range circle are legible in the shot.
const setup = await page.evaluate(async () => {
  const { default: AIChampion } = await import(
    '/src/game/gameObject/attackableUnits/AIChampion.ts'
  );
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;

  // The wave clock keeps refilling the lanes, and a minion or turret wandering
  // into the pair would push them around and muddy every distance below.
  game.minionSpawner.update = () => {};

  const clearing = { x: game.mapSize / 2, y: game.mapSize / 2 };
  champion.stats.maxHealth.baseValue = 10_000;
  champion.stats.health.baseValue = 10_000;
  champion.deathData = null;
  champion.teleportTo(clearing.x, clearing.y);
  champion.stopMovement();

  const victim = new AIChampion({
    game,
    position: window.createVector(clearing.x + 40, clearing.y),
    teamId: 'e2e-victim',
  });
  victim._autoMove = false;
  victim._autoCast = false;
  victim.stats.maxHealth.baseValue = 10_000;
  victim.stats.health.baseValue = 10_000;
  game.objectManager.addObject(victim);
  window.__reachVictim = victim;

  // everything else, including turrets and the standing wave, goes off-map
  window.__quarantine = () => {
    for (const object of game.objectManager.objects) {
      if (object === champion || object === victim) continue;
      if (typeof object.teleportTo === 'function' && object.addBuff) {
        object.teleportTo(-20_000, -20_000);
        object.stopMovement?.();
      }
    }
    champion.deathData = null;
    champion.stats.health.baseValue = champion.stats.maxHealth.value;
    champion.stopMovement();
  };
  window.__quarantine();

  game.camera.target = champion.position;
  game.camera.scale = 1.6;
  game.camera.currentScale = 1.6;

  return { championSize: champion.stats.size.value, victimSize: victim.stats.size.value };
});

await page.waitForTimeout(1_200);
await page.evaluate(() => window.__quarantine());

/**
 * Casts Lee Sin R for real and reports whether it connected, alongside what the
 * raw authored range would have found from the same spot.
 */
const castLeeSinR = async (overrideRange = null) =>
  page.evaluate(async override => {
    const { buildContentApi } = await import('/src/content/ContentApi.ts');
    const api = buildContentApi();
    const { default: makeLeeSin_R } = await import('/packs/riot/spells/LeeSin_R.ts');
    const LeeSin_R = makeLeeSin_R(api);
    const { Circle } = await import('/src/libs/quadtree.ts');
    const { PredefinedFilters } = await import('/src/game/managers/ObjectManager.ts');
    const { DEFAULT_BODY_RADIUS, effectiveRange } = await import('/src/game/combat/Reach.ts');

    const game = window.__lol2d.scene.oScene.game;
    const champion = game.player;
    const victim = window.__reachVictim;

    const separation = Math.hypot(
      victim.position.x - champion.position.x,
      victim.position.y - champion.position.y
    );

    const spell = new LeeSin_R(champion);
    // `override` shortens the authored number by exactly the caster's excess,
    // so the circle the spell ends up querying is the raw one main queries.
    // Everything else — the cast, the buffs, the kick — is the real code path.
    if (override !== null) {
      spell.rangeToCheckEnemies = override - Math.max(0, champion.bodyRadius - DEFAULT_BODY_RADIUS);
    }
    const authored = spell.rangeToCheckEnemies;
    const withSize = effectiveRange(authored, champion);

    const query = radius =>
      game.objectManager.queryObjects({
        area: new Circle({ x: champion.position.x, y: champion.position.y, r: radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(champion.teamId)],
      });

    // what main would find, and what this branch asks for
    const rawHits = query(authored).filter(unit => unit === victim).length;
    const sizedHits = query(withSize).filter(unit => unit === victim).length;

    // then cast it for real and see whether the kick landed on anybody
    const healthBefore = victim.stats.health.value;
    const buffsBefore = victim.buffs.length;
    const pressed = spell.press(
      Object.freeze({
        spellId: spell.id,
        activationId: 'e2e-reach',
        startedAtMs: Date.now(),
        caster: champion,
        origin: Object.freeze({ x: champion.position.x, y: champion.position.y }),
        cursorWorld: Object.freeze({ x: victim.position.x, y: victim.position.y }),
        direction: Object.freeze({ x: 1, y: 0 }),
      })
    );

    return {
      pressed,
      spellState: spell.state,
      casterCanCast: champion.canCast,
      casterIsDead: champion.isDead,
      championSize: champion.stats.size.value,
      bodyGap: Math.round(separation),
      minimumGap: champion.bodyRadius + victim.bodyRadius,
      authoredRange: authored,
      effectiveRange: withSize,
      rawQueryHitsVictim: rawHits > 0,
      sizedQueryHitsVictim: sizedHits > 0,
      healthBefore,
      healthAfter: victim.stats.health.value,
      buffsBefore,
      buffsAfter: victim.buffs.length,
      buffNames: victim.buffs.map(buff => buff.constructor.name),
    };
  }, overrideRange);

// ------------------------------------------------------- case 1: normal size
const normalSize = await castLeeSinR();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}-default-size.png` });

// ------------------------------------------- case 2: grown by Cho'Gath's R
//
// Stacked through the real ability, not by writing the stat: Feast is what
// makes a champion this big in a real game, and its buff is what has to hold
// the size while the bodies settle.
const grow = await page.evaluate(async () => {
  const { MAX_UNIT_SIZE } = await import('/src/game/gameObject/Stats.ts');
  const { buildContentApi } = await import('/src/content/ContentApi.ts');
  const api = buildContentApi();
  const { makeChoGath_R_Growth } = await import('/packs/riot/spells/ChoGath_R.ts');
  const ChoGath_R_Growth = makeChoGath_R_Growth(api);
  const game = window.__lol2d.scene.oScene.game;
  const champion = game.player;
  const victim = window.__reachVictim;

  window.__quarantine();
  // reset the victim so the later casts are measured from full health
  victim.stats.health.baseValue = victim.stats.maxHealth.value;
  for (const buff of victim.buffs.slice()) buff.deactivateBuff();
  victim.buffs = [];

  for (let stack = 0; stack < 40; stack++) {
    champion.addBuff(new ChoGath_R_Growth(600_000, champion, champion));
  }
  victim.teleportTo(champion.position.x + 40, champion.position.y);

  return {
    size: champion.stats.size.value,
    ceiling: MAX_UNIT_SIZE,
    stacks: champion.buffs.filter(buff => buff instanceof ChoGath_R_Growth).length,
    buffNames: champion.buffs.map(buff => buff.constructor.name),
    sizeBaseBonus: champion.stats.size.baseBonus,
    championIsDead: champion.isDead,
  };
});

/** Puts the enemy back on the caster's doorstep and lets separation settle it. */
const resettleVictim = async () => {
  await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const victim = window.__reachVictim;
    window.__quarantine();
    for (const buff of victim.buffs.slice()) buff.deactivateBuff();
    victim.buffs = [];
    victim.deathData = null;
    victim.stats.health.baseValue = victim.stats.maxHealth.value;
    victim.teleportTo(game.player.position.x + 40, game.player.position.y);
    victim.stopMovement();
  });
  // real frames: the size buff applies, then body separation pushes the two
  // apart to wherever it actually holds them
  await page.waitForTimeout(2_500);
};

// ------------------------------------ case 3: grown, with main's raw circle
//
// The whole cast runs for real; only the authored number is shortened by the
// caster's excess, so the circle the spell asks the quadtree for is exactly the
// 80 that main asks for. This is what the ability does on main today.
await resettleVictim();
const grownOnMain = await castLeeSinR(80);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}-grown-on-main.png` });

// ------------------------------------------- case 4: grown, with this branch
await resettleVictim();
const grownSize = await castLeeSinR();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}-grown.png` });

console.log(
  JSON.stringify({ setup, normalSize, grow, grownOnMain, grownSize, errors }, null, 2)
);

const failures = [];
if (!normalSize.sizedQueryHitsVictim) failures.push('default-size cast did not reach the enemy');
if (normalSize.effectiveRange !== normalSize.authoredRange) {
  failures.push('range drifted at default size');
}
if (grownSize.championSize !== grow.ceiling) failures.push('champion did not reach MAX_UNIT_SIZE');
if (grownOnMain.bodyGap < grownOnMain.authoredRange) {
  failures.push('bodies did not settle beyond the raw range — the bug cannot reproduce');
}
if (grownOnMain.healthAfter < grownOnMain.healthBefore || grownOnMain.buffsAfter > 0) {
  failures.push("main's raw circle connected — the bug did not reproduce");
}
if (grownSize.rawQueryHitsVictim) {
  failures.push('the authored range still reached — the bug did not reproduce');
}
if (!grownSize.sizedQueryHitsVictim) failures.push('grown cast still cannot reach the enemy');
if (grownSize.healthAfter >= grownSize.healthBefore) failures.push('grown cast dealt no damage');
if (grownSize.buffsAfter === 0) failures.push('grown cast applied no crowd control');

if (failures.length) console.error(`FAILED:\n- ${failures.join('\n- ')}`);
await shutdown(browser);
if (failures.length || errors.length) process.exitCode = 1;
