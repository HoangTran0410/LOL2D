/**
 * The four changes Vitest structurally cannot see, driven in the real game.
 *
 * Everything about *what* these do is already pinned by unit tests. What only a
 * real renderer and a real preset can answer is whether they are wired in at
 * all: `drawExecuteMarks` hangs off `Game.draw`, the Cho'Gath tally lived in a
 * buff's `draw()`, the Taunt leash is drawn from the victim, and Camille's
 * grapple only meets an Anivia wall if both are actually in the object manager
 * of a running match.
 *
 * Output is numeric on purpose — see the note in CLAUDE.md about screenshots
 * costing what 600 lines of source costs. Three frames are saved for judging
 * the *look*; nothing here needs them read to know whether it passed.
 *
 *   node tests/e2e/drive-execute-taunt-terrain.mjs [outDir]
 *
 * Requires a system Chrome install.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-execute-taunt';
const CFG_KEY = 'lol2d:pregameConfig:v1';
const VIEWPORT = { width: 1280, height: 900 };

mkdirSync(OUT, { recursive: true });

const MATCH_CONFIG = {
  player: {
    mode: 'champion',
    championName: 'Nasus',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
};

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

/** Empties the arena and installs the helpers every stage below reuses. */
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;
  const KEEP = new Set(['Turret', 'Fountain']);

  const clear = () => {
    for (const object of game.objectManager.objects) {
      if (object === game.player) continue;
      if (KEEP.has(object.constructor?.name ?? '')) continue;
      object.toRemove = true;
    }
    game.objectManager.update();
  };

  const become = championName => {
    game.director.applyLoadout(game.player, {
      mode: 'champion',
      championName,
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: Array(7).fill('random'),
    });
    game.objectManager.update();
    const self = game.player;
    for (const buff of [...self.buffs]) buff.deactivateBuff();
    self.updateBuffs();
    self.position.set(window.__rig.home.x, window.__rig.home.y);
    self.destination.set(window.__rig.home.x, window.__rig.home.y);
    self.stats.mana.baseValue = self.stats.maxMana.value;
    self.stats.health.baseValue = self.stats.maxHealth.value;
    return self;
  };

  const dummyAt = (dx, dy, health) => {
    const bot = game.director.addBot({
      mode: 'champion',
      championName: 'Garen',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: Array(7).fill('random'),
    });
    if (!bot) return null;
    game.director.setBotBehaviour(bot, { autoMove: false, autoAttack: false, autoCast: false });
    game.objectManager.update();
    const { home } = window.__rig;
    bot.position.set(home.x + dx, home.y + dy);
    bot.destination.set(bot.position.x, bot.position.y);
    bot.stats.maxHealth.baseValue = 200;
    bot.stats.health.baseValue = health;
    return bot;
  };

  const spellNamed = wanted => game.player.spells.find(s => s?.constructor?.name === wanted);

  const fire = (wanted, aimX, aimY) => {
    const { home } = window.__rig;
    const spell = spellNamed(wanted);
    if (!spell) return null;
    game.worldMouse = createVector(home.x + aimX, home.y + aimY);
    spell.currentCooldown = 0;
    spell.cast();
    return spell;
  };

  window.__rig = { game, home: player.position.copy(), clear, become, dummyAt, spellNamed, fire };
  window.__rig.clear();
});

const frames = ms => page.waitForTimeout(ms);
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });

// ── 1. Execute marks: the ring only appears over someone the cast would kill ──
{
  await page.evaluate(() => {
    const { become, dummyAt, clear } = window.__rig;
    clear();
    become('Nasus');
    // Both well inside Nasus Q's 150px reach — placed at 175px the first time,
    // which made the range query, not the marking, the thing under test.
    window.__stage = { doomed: dummyAt(105, -40, 8), healthy: dummyAt(105, 40, 200) };
  });
  // `dummyAt` moves a bot after the flush, so the quadtree still has it at its
  // spawn point until the next frame rebuilds the tree. Every range query below
  // is against that tree; asserting before it catches up tests nothing.
  await frames(300);

  const marks = await page.evaluate(() => {
    const { spellNamed } = window.__rig;
    const { doomed, healthy } = window.__stage;
    const q = spellNamed('Nasus_Q');
    q.currentCooldown = 0;
    const candidates = q.executeCandidates();
    return {
      ready: q.isCastableNow,
      candidates: candidates.length,
      // the module's own answer, read through the spell's two methods
      lethal: candidates.filter(
        u => Math.round(q.executeDamageAgainst(u)) >= u.stats.health.value + u.shieldAmount
      ).length,
      doomedHealth: Math.round(doomed?.stats.health.value ?? -1),
      healthyHealth: Math.round(healthy?.stats.health.value ?? -1),
    };
  });
  await shot('1-execute-mark');
  check(
    'execute mark: exactly one of two enemies in range is lethal',
    marks.ready && marks.candidates === 2 && marks.lethal === 1,
    `ready=${marks.ready} candidates=${marks.candidates} lethal=${marks.lethal} ` +
      `doomed=${marks.doomedHealth}hp healthy=${marks.healthyHealth}hp`
  );
}

// ── 2. Nasus Q / Cho'Gath R stack on the kill only ───────────────────────────
/**
 * Two casts, a frame apart on purpose. `Spell.cast()` refuses unless the
 * runtime is READY, and zeroing `currentCooldown` only feeds that state on the
 * next update — so both casts in one `evaluate` is one cast and a silent no-op.
 */
const stackRun = async (championName, spellName, distance) => {
  await page.evaluate(
    ([champion, dx]) => {
      const { become, dummyAt, clear } = window.__rig;
      clear();
      become(champion);
      window.__stage = { tank: dummyAt(dx, 0, 200) };
    },
    [championName, distance]
  );
  await frames(300);

  const before = await page.evaluate(
    ([spell, dx]) => {
      const { fire, spellNamed } = window.__rig;
      const start = spellNamed(spell).stackCount;
      fire(spell, dx, 0);
      return start;
    },
    [spellName, distance]
  );
  await frames(300);

  const afterSurvivor = await page.evaluate(
    ([spell, dx]) => {
      const { fire, spellNamed } = window.__rig;
      const count = spellNamed(spell).stackCount;
      window.__stage.tank.stats.health.baseValue = 5;
      fire(spell, dx, 0);
      return count;
    },
    [spellName, distance]
  );
  await frames(300);

  return page.evaluate(
    ([spell, hit, start]) => ({
      before: start,
      afterSurvivor: hit,
      afterKill: window.__rig.spellNamed(spell).stackCount,
      victimDead: window.__stage.tank.isDead,
      victimHealth: Math.round(window.__stage.tank.stats.health.value),
    }),
    [spellName, afterSurvivor, before]
  );
};

{
  const nasus = await stackRun('Nasus', 'Nasus_Q', 90);
  check(
    'Nasus Q: no stack for a hit, one for a kill',
    nasus.before === 0 && nasus.afterSurvivor === 0 && nasus.afterKill === 1 && nasus.victimDead,
    `${nasus.before} -> hit ${nasus.afterSurvivor} -> kill ${nasus.afterKill}, dead=${nasus.victimDead}`
  );

  const cho = await stackRun("Cho'Gath", 'ChoGath_R', 110);
  await shot('2-chogath-stacks');
  check(
    "Cho'Gath R: growth is paid for by the meal",
    cho.before === 0 && cho.afterSurvivor === 0 && cho.afterKill === 1 && cho.victimDead,
    `hit ${cho.afterSurvivor} -> kill ${cho.afterKill}, dead=${cho.victimDead}`
  );
}

// ── 3. Camille E catches on an Anivia ice wall ───────────────────────────────
{
  const hook = await page.evaluate(async () => {
    const { become, fire, clear, game, home } = window.__rig;
    clear();
    // Anivia builds the wall, then the player becomes Camille and shoots at it.
    become('Anivia');
    fire('Anivia_W', 320, 0);
    game.objectManager.update();
    const walls = game.objectManager.objects.filter(
      o => o.constructor?.name === 'Anivia_W_Object'
    ).length;

    become('Camille');
    // `become` wipes buffs but not world objects, so the wall is still standing.
    game.objectManager.update();
    const e = fire('Camille_E', 520, 0);
    window.__hookSpell = e;
    return { walls, fired: !!e, playerX: game.player.position.x - home.x };
  });
  // let the grapple fly, catch, and pull her in
  await frames(1_800);
  const caught = await page.evaluate(() => {
    const { game, home } = window.__rig;
    const spell = window.__hookSpell;
    return {
      attached: !!spell?.attachedToWall,
      travelled: Math.round(game.player.position.x - home.x),
    };
  });
  await shot('3-camille-on-ice-wall');
  check(
    'Camille E: the grapple catches on spell-made terrain',
    hook.walls === 1 && hook.fired && caught.attached,
    `walls=${hook.walls} attached=${caught.attached} travelled=${caught.travelled}px`
  );
}

// ── 4. Rammus: the shell bites back, the taunt takes the order ───────────────
{
  const rammus = await page.evaluate(() => {
    const { become, dummyAt, fire, clear, game } = window.__rig;
    clear();
    become('Rammus');
    const attacker = dummyAt(100, 0, 200);
    const second = dummyAt(-90, 60, 200);
    fire('Rammus_W', 0, 0);
    game.objectManager.update();

    const before = attacker.stats.health.value;
    game.player.takeDamage(50, attacker);
    const reflected = before - attacker.stats.health.value;
    window.__stage = { attacker, second };
    return { reflected };
  });
  // the taunt is a range query, so it needs a frame for the tree to catch up
  await frames(300);
  const taunt = await page.evaluate(() => {
    const { fire, game } = window.__rig;
    const { attacker, second } = window.__stage;
    fire('Rammus_E', 0, 0);
    game.objectManager.update();
    return {
      bothOrdered:
        attacker.basicAttack?.target === game.player &&
        second.basicAttack?.target === game.player,
      canAttack: attacker.canAttack,
      canCast: attacker.canCast,
    };
  });
  await frames(400);
  await shot('4-rammus-taunt-and-shell');
  check(
    'Rammus W: 80% of the swing comes back',
    rammus.reflected === 40,
    `attacker lost ${rammus.reflected} of a 50 swing`
  );
  check(
    'Rammus E: everyone in the ring is ordered onto Rammus and can still swing',
    taunt.bothOrdered && taunt.canAttack && !taunt.canCast,
    `bothOrdered=${taunt.bothOrdered} canAttack=${taunt.canAttack} canCast=${taunt.canCast}`
  );
}

// ── 5. The marks on an aimed spell, and Annie's shield burning a spell ───────
{
  // Asserted rather than assumed: one run lost `window.__rig` between sections
  // and the next `evaluate` died on a destructure, which reports as a crash
  // rather than as the flake it was. This turns that into a legible failure.
  const rig = await page.evaluate(() => ({
    alive: !!window.__rig,
    scene: window.__lol2d?.scene?.oScene?.constructor?.name ?? 'none',
  }));
  check('the harness survived the earlier sections', rig.alive, `scene=${rig.scene}`);
  if (!rig.alive) {
    console.error('\nharness lost — skipping the remaining checks');
    await browser.close();
    await server.close();
    process.exit(1);
  }

  await page.evaluate(() => {
    const { become, dummyAt, clear } = window.__rig;
    clear();
    become('Veigar');
    // One doomed body on the line east, one healthy body the same distance
    // south — the shot can only threaten one of them at a time.
    window.__stage = { east: dummyAt(300, 0, 8), south: dummyAt(0, 300, 8) };
  });
  await frames(300);

  const aimed = await page.evaluate(() => {
    const { spellNamed, game, home } = window.__rig;
    const q = spellNamed('Veigar_Q');
    const marksWhenAimedAt = (dx, dy) => {
      game.worldMouse = createVector(home.x + dx, home.y + dy);
      return q.executeCandidates().map(u => u.id);
    };
    const east = marksWhenAimedAt(500, 0);
    const south = marksWhenAimedAt(0, 500);
    return {
      east: east.length,
      south: south.length,
      swapped: east.length === 1 && south.length === 1 && east[0] !== south[0],
    };
  });
  await shot('5-veigar-aim-mark');
  check(
    'Veigar Q marks by where the cursor points, not by what is in range',
    aimed.swapped,
    `aimed east -> ${aimed.east} target(s), aimed south -> ${aimed.south}, different unit=${aimed.swapped}`
  );

  await page.evaluate(() => {
    const { become, dummyAt, clear } = window.__rig;
    clear();
    become('Annie');
    window.__stage = { attacker: dummyAt(120, 0, 200), doomed: dummyAt(-140, 0, 8) };
  });
  await frames(300);

  const annie = await page.evaluate(() => {
    const { spellNamed, fire, game } = window.__rig;
    const { attacker, doomed } = window.__stage;
    const q = spellNamed('Annie_Q');
    const marked = q.executeCandidates().filter(u => u.stats.health.value <= 26).length;

    fire('Annie_E', 0, 0);
    game.objectManager.update();
    const before = attacker.stats.health.value;
    // Three spell hits — no basic attacks anywhere near this, which is the
    // whole point: the old burn only ever fired on ON_ATTACK_HIT.
    for (let i = 0; i < 3; i++) game.player.takeDamage(10, attacker);
    return {
      marked,
      doomedHealth: Math.round(doomed.stats.health.value),
      burned: before - attacker.stats.health.value,
      annieHealth: Math.round(game.player.stats.health.value),
    };
  });
  await shot('6-annie-shield-burn');
  check(
    'Annie Q marks the enemy its fireball would finish',
    annie.marked === 1,
    `marked=${annie.marked} doomed=${annie.doomedHealth}hp`
  );
  check(
    'Annie E burns spell damage, every hit, even through a full shield',
    annie.burned === 42 && annie.annieHealth === 100,
    `attacker lost ${annie.burned} to 3 pokes of 10; Annie at ${annie.annieHealth}hp`
  );
}

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await server.close();

console.log(`\nframes in ${OUT}`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
