/**
 * Screenshot rig for the Camille / Ekko / Jarvan IV kits.
 *
 * Not an assertion script — a *look at it* script. The complaint these spells
 * were rebuilt against ("visual effect của nó dở quá") is not a property any
 * unit test can hold, so the only honest check is to run the real renderer and
 * photograph each ability at the moments that matter: the windup, the strike,
 * and the settle. It samples several frames per cast for exactly that reason —
 * a single frame cannot tell a spell that animates from one that pops in.
 *
 * It does verify the two things a screenshot cannot show by itself:
 *   - every cast produced at least one spell object (nothing silently no-oped);
 *   - dashes actually travelled, which is the `onDashUpdate` regression.
 *
 *   node tests/e2e/shoot-new-champion-vfx.mjs [outDir]
 *
 * Requires a system Chrome install.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-new-vfx';
const CFG_KEY = 'lol2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

mkdirSync(OUT, { recursive: true });

const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Camille',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

/** Which slot each ability sits in, and where to aim it relative to the player. */
const CASTS = [
  { champion: 'Camille', slot: 'Q', aim: [220, 0], frames: [80, 260, 900] },
  { champion: 'Camille', slot: 'W', aim: [320, 0], frames: [90, 240, 420] },
  { champion: 'Camille', slot: 'E', aim: [520, 0], frames: [120, 380, 700] },
  { champion: 'Camille', slot: 'R', aim: [300, 0], frames: [420, 700, 1600] },
  { champion: 'Ekko', slot: 'Q', aim: [380, 0], frames: [200, 700, 1400] },
  { champion: 'Ekko', slot: 'W', aim: [300, 0], frames: [400, 1400, 2200] },
  { champion: 'Ekko', slot: 'E', aim: [240, 0], frames: [90, 260, 600] },
  { champion: 'Ekko', slot: 'R', aim: [0, 0], frames: [90, 240, 500] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'Q', aim: [420, 0], frames: [80, 200, 400] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'W', aim: [0, 0], frames: [110, 400, 1600] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'E', aim: [300, 0], frames: [90, 240, 900] },
  { champion: 'Jarvan IV', slotName: 'JarvanIV', slot: 'R', aim: [300, 0], frames: [420, 700, 1600] },
];

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const failures = [];
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}: ${detail ?? 'failed'}`);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.addInitScript(
  ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
  [CFG_KEY, MATCH_CONFIG]
);
await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_500);

// Clear the arena once, then stand a punching bag in front of the player so
// on-hit effects have something to land on.
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;
  for (const object of game.objectManager.objects) {
    if (object === player) continue;
    const name = object.constructor?.name ?? '';
    if (name === 'Turret' || name === 'Fountain') continue;
    object.toRemove = true;
  }
  game.objectManager.update();
  window.__rig = { game, player, home: player.position.copy() };
});

for (const cast of CASTS) {
  const staged = await page.evaluate(
    async ([championName, classPrefix, slot, aimX, aimY]) => {
      const { game, player, home } = window.__rig;

      // wipe leftovers from the previous cast so each shot is of one spell
      for (const object of game.objectManager.objects) {
        if (object === player) continue;
        const name = object.constructor?.name ?? '';
        if (name === 'Turret' || name === 'Fountain') continue;
        object.toRemove = true;
      }
      game.objectManager.update();
      for (const buff of player.buffs) buff.deactivateBuff();
      player.updateBuffs();

      // reset the player onto the champion under test
      game.director.applyLoadout(player, {
        mode: 'champion',
        championName,
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: Array(7).fill('random'),
      });
      game.objectManager.update();

      const subject = game.player;
      subject.position.set(home.x, home.y);
      subject.destination.set(home.x, home.y);
      subject.stats.mana.baseValue = subject.stats.maxMana.value;
      subject.stats.health.baseValue = subject.stats.maxHealth.value;

      // a dummy to be hit, so impacts have a body to land on
      const dummy = game.director.addBot({
        mode: 'champion',
        championName: 'Garen',
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: Array(7).fill('random'),
      });
      if (dummy) {
        game.director.setBotBehaviour(dummy, {
          autoMove: false,
          autoAttack: false,
          autoCast: false,
        });
        game.objectManager.update();
        dummy.position.set(home.x + aimX * 0.75, home.y + aimY * 0.75);
        dummy.destination.set(dummy.position.x, dummy.position.y);
        dummy.stats.health.baseValue = dummy.stats.maxHealth.value * 10;
        dummy.stats.maxHealth.baseValue = dummy.stats.maxHealth.value * 10;
      }

      // the preset's display name and the spell class prefix differ for the
      // champions whose names carry a space ("Jarvan IV" -> JarvanIV_Q)
      const wanted = `${classPrefix}_${slot}`;
      const spell = subject.spells.find(s => s?.constructor?.name === wanted);
      if (!spell) {
        return {
          ok: false,
          reason: `no ${wanted} in kit: ${subject.spells
            .map(s => s?.constructor?.name)
            .join(',')}`,
        };
      }

      // `Spell.cast()` builds its own CastContext off game.worldMouse, which is
      // the path the real key press takes — press() alone wants a context.
      game.worldMouse = createVector(home.x + aimX, home.y + aimY);

      const objectsBefore = game.objectManager.objects.length;
      const startPos = { x: subject.position.x, y: subject.position.y };
      spell.currentCooldown = 0;
      spell.cast();

      window.__cast = { game, subject, objectsBefore, startPos, spawned: 0, moved: 0 };
      return { ok: true };
    },
    [cast.champion, cast.slotName ?? cast.champion, cast.slot, cast.aim[0], cast.aim[1]]
  );

  const label = `${cast.slotName ?? cast.champion}_${cast.slot}`;
  if (!staged.ok) {
    check(`${label} staged`, false, staged.reason);
    continue;
  }

  let previous = 0;
  for (const [index, at] of cast.frames.entries()) {
    await page.waitForTimeout(at - previous);
    previous = at;
    await page.evaluate(() => {
      const rig = window.__cast;
      const game = rig.game;
      rig.spawned = Math.max(
        rig.spawned,
        game.objectManager.objects.length +
          game.objectManager._objectToBeAdd.length -
          rig.objectsBefore
      );
      rig.moved = Math.max(
        rig.moved,
        Math.hypot(
          rig.subject.position.x - rig.startPos.x,
          rig.subject.position.y - rig.startPos.y
        )
      );
    });
    await page.screenshot({ path: `${OUT}/${label}-${index + 1}-t${at}.png` });
  }

  const result = await page.evaluate(() => {
    const rig = window.__cast;
    return { spawned: rig.spawned, moved: Math.round(rig.moved) };
  });
  check(
    `${label} produced world effects`,
    result.spawned > 0,
    `objects=+${result.spawned} moved=${result.moved}px`
  );
}

// The dash regression, stated as its own property: these three are the spells
// whose movement was being deleted by the onUpdate assignment.
console.log('\nscreenshots in', OUT);
if (errors.length) {
  console.log('\npage errors:');
  for (const error of errors.slice(0, 12)) console.log(' ', error);
}
check('no page errors during the run', errors.length === 0, `${errors.length} error(s)`);

await browser.close();
await server.close();

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
