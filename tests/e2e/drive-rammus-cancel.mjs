/**
 * "Why can a basic attack cancel Rammus Q?" — reproduced against the real game.
 *
 * Boots its own Vite dev server on a free port, opens the game in system Chrome
 * through Playwright and reaches the live scene through the DEV-only
 * `window.__lol2d` handle set in src/main.ts.
 *
 * Powerball has exactly two documented ends: the lifetime running out (or the
 * owner dying) and the ball connecting with an enemy, which also deactivates the
 * speed buff. A third outcome is possible and is what this script is looking
 * for: the roll never ends at all, and the champion simply stops rolling because
 * something else took his movement away.
 *
 * Three runs, each starting a fresh Powerball on the player:
 *   control  — roll with a plain move order, nothing else;
 *   ranged   — roll, then order a basic attack with attackRange 300;
 *   melee    — roll, then order a basic attack with attackRange 50;
 *   stunned  — roll, then land a Stun on the roller and nothing else, which the
 *              INDEPENDENT form in CancelPolicy says must not end it.
 *
 * Each run reports whether the ball object survived its full lifetime, whether a
 * Rammus_Q_Crash was created (the only evidence of the contact path), whether
 * the Powerball buff was still on the champion at the end, and — the part the
 * owner is actually seeing — how far the champion travelled per second.
 *
 *   node tests/e2e/drive-rammus-cancel.mjs [outPrefix]
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-rammus-cancel';

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const report = {};

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // Empty the arena down to the player plus one pinned dummy, and give the
  // player Rammus Q whatever champion the menu rolled.
  report.setup = await page.evaluate(async () => {
    const { default: DummyChampion } = await import(
      '/src/game/gameObject/attackableUnits/DummyChampion.ts'
    );
    // Every pack spell's export is a factory now (batch 4 task 3), resolved
    // against the cached ContentApi singleton spellRegistry.ts itself builds
    // against — reused below for Rammus_Q_Object too, so both share identity
    // with whatever the live game has already resolved.
    const { buildContentApi } = await import('/src/content/ContentApi.ts');
    const api = buildContentApi();
    const { default: makeRammus_Q } = await import('/packs/riot/spells/Rammus_Q.ts');
    const Rammus_Q = makeRammus_Q(api);
    const { getChampionPresetRandom } = await import('/src/game/preset.ts');
    const game = window.__lol2d.scene.oScene.game;
    const player = game.player;

    for (const object of game.objectManager.objects) {
      if (object === player) continue;
      const name = object.constructor?.name ?? '';
      if (name === 'Turret' || name === 'Fountain') continue;
      object.toRemove = true;
    }
    game.objectManager.update();
    for (const buff of [...player.buffs]) buff.deactivateBuff();
    player.updateBuffs();
    player.deathData = null;
    player.stats.health.baseValue = player.stats.maxHealth.value;
    player.stats.mana.baseValue = 9_999;
    player.stats.maxMana.baseValue = 9_999;

    const home = { x: 2_600, y: 2_600 };
    player.position.set(home.x, home.y);
    player.destination.set(home.x, home.y);

    // The roll has to have somewhere to go, or a wall stops the champion and the
    // measurement reads terrain instead of the attack order. Walk him a short way
    // down each of eight headings and keep the clearest one; every run below is
    // laid out along it.
    //
    // The lane must also be empty of turrets: the ball connects with anything it
    // can damage, and a turret standing in the way ends the roll for a reason
    // that has nothing to do with the attack order under test.
    const obstacles = game.objectManager.objects.filter(
      o => o !== player && typeof o.takeDamage === 'function'
    );
    const clearOf = angle => {
      let nearest = Infinity;
      for (const o of obstacles) {
        for (let t = 0; t <= 1.001; t += 0.05) {
          const x = home.x + Math.cos(angle) * 600 * t;
          const y = home.y + Math.sin(angle) * 600 * t;
          nearest = Math.min(nearest, Math.hypot(o.position.x - x, o.position.y - y));
        }
      }
      return nearest;
    };
    const lane = { angle: 0, travelled: 0, clearance: 0 };
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * Math.PI * 2;
      const clearance = clearOf(angle);
      if (clearance < 300) continue;
      player.position.set(home.x, home.y);
      player.destination.set(home.x, home.y);
      await new Promise(resolve => setTimeout(resolve, 120));
      player.moveTo(home.x + Math.cos(angle) * 600, home.y + Math.sin(angle) * 600);
      await new Promise(resolve => setTimeout(resolve, 700));
      const travelled = Math.hypot(player.position.x - home.x, player.position.y - home.y);
      if (travelled > lane.travelled) {
        lane.angle = angle;
        lane.travelled = travelled;
        lane.clearance = Math.round(clearance);
      }
    }
    player.position.set(home.x, home.y);
    player.destination.set(home.x, home.y);
    const heading = { x: Math.cos(lane.angle), y: Math.sin(lane.angle) };

    // Inside the champion's own sight (500): the attack controller leashes an
    // order to `visionRadius`, and an order dropped on the first frame would
    // measure the leash instead of the chase.
    const spot = { x: home.x + heading.x * 420, y: home.y + heading.y * 420 };
    const dummy = new DummyChampion({
      game,
      position: window.createVector(spot.x, spot.y),
      preset: getChampionPresetRandom(),
    });
    dummy.stats.speed.baseValue = 0;
    dummy.stats.healthRegen.baseValue = 0;
    dummy.stats.maxHealth.baseValue = 100_000;
    dummy.stats.health.baseValue = 100_000;
    game.objectManager.addObject(dummy);
    game.objectManager.update();

    const q = new Rammus_Q(player);
    player.spells[1] = q;
    window.__probe = { player, dummy, q, home, spot, RammusQ: Rammus_Q };

    game.camera.target = null;
    game.camera.scale = 0.75;
    game.camera.currentScale = 0.75;
    game.camera.position.set((home.x + spot.x) / 2, (home.y + spot.y) / 2);

    // The ball is a circle glued to the caster; the attack controller stops the
    // caster at `attackRange` plus both bodies. Printing the two side by side is
    // the whole arithmetic of the contact question.
    const { makeRammus_Q_Object } = await import('/packs/riot/spells/Rammus_Q.ts');
    const ball = new (makeRammus_Q_Object(api))(player);
    return {
      playerChampion: player.name,
      laneHeadingDeg: Math.round((lane.angle * 180) / Math.PI),
      laneWalkProbe: Math.round(lane.travelled),
      laneClearOfObstaclesBy: lane.clearance,
      attackRangeDefault: player.stats.attackRange.value,
      rangedByDefault: player.basicAttack.isRanged,
      playerBodyRadius: player.bodyRadius,
      dummyBodyRadius: dummy.bodyRadius,
      ballReachToDummy: Math.round(ball.reachTo(dummy)),
      attackReachAtRange300: Math.round(player.basicAttack.reachTo(dummy)),
      attackReachAtRange50: 50 + player.bodyRadius + dummy.bodyRadius,
      startDistance: Math.round(player.position.dist(dummy.position)),
    };
  });

  /**
   * One run: reset both units, start Powerball, apply the run's order, then
   * sample the world every 100ms for the roll's whole nominal lifetime.
   */
  const run = async (label, attackRange, orderAttack, stunAtMs = null) =>
    page.evaluate(
      async ({ label, attackRange, orderAttack, stunAtMs }) => {
        const game = window.__lol2d.scene.oScene.game;
        const { player, dummy, q, home, spot, RammusQ } = window.__probe;

        player.basicAttack.clear();
        for (const buff of [...player.buffs]) buff.deactivateBuff();
        player.updateBuffs();
        player.position.set(home.x, home.y);
        player.destination.set(home.x, home.y);
        dummy.position.set(spot.x, spot.y);
        dummy.destination.set(spot.x, spot.y);
        dummy.deathData = null;
        dummy.stats.health.baseValue = dummy.stats.maxHealth.value;
        player.stats.attackRange.baseValue = attackRange;
        player.stats.mana.baseValue = 9_999;
        q.resetCoolDown();
        for (const object of game.objectManager.objects) {
          const name = object.constructor?.name ?? '';
          if (name.startsWith('Rammus_Q')) object.toRemove = true;
        }
        game.objectManager.update();
        await new Promise(resolve => setTimeout(resolve, 200));

        const ballsIn = () =>
          game.objectManager.objects.filter(o => o.constructor?.name === 'Rammus_Q_Object');
        const crashesIn = () =>
          game.objectManager.objects.filter(o => o.constructor?.name === 'Rammus_Q_Crash');
        const powerball = () =>
          player.buffs.find(b => b.constructor?.name === 'Rammus_Q_Powerball') ?? null;

        // Aim the roll at the dummy and start it. Rammus Q is a plain movement
        // buff: without a move order the champion does not roll anywhere, so the
        // move order is part of casting it, not a confound.
        game.worldMouse.set(dummy.position.x, dummy.position.y);
        q.cast();
        player.moveTo(dummy.position.x, dummy.position.y);

        const started = {
          ball: ballsIn().length,
          buff: !!powerball(),
          spellState: q.state,
        };
        if (orderAttack) player.basicAttack.order(dummy);

        const Stun = (await import('/src/game/gameObject/buffs/Stun.ts')).default;
        const samples = [];
        let sawCrash = false;
        let crashVictim = null;
        let stunned = false;
        let last = { x: player.position.x, y: player.position.y };
        for (let i = 0; i < 45; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const balls = ballsIn();
          if (stunAtMs !== null && !stunned && (i + 1) * 100 >= stunAtMs) {
            stunned = true;
            player.addBuff(new Stun(1_500, player, player));
          }
          const crashes = crashesIn();
          if (crashes.length && !sawCrash) {
            sawCrash = true;
            // Attribute the crash: the ball connects with whatever it can damage,
            // so a turret in the lane would otherwise read as "the dummy".
            const at = crashes[0].position;
            let nearest = null;
            let best = Infinity;
            for (const o of game.objectManager.objects) {
              if (o === player || typeof o.takeDamage !== 'function') continue;
              const gap = Math.hypot(o.position.x - at.x, o.position.y - at.y);
              if (gap < best) {
                best = gap;
                nearest = o;
              }
            }
            crashVictim = {
              isTheDummy: nearest === dummy,
              what: nearest?.constructor?.name ?? null,
              gap: Math.round(best),
            };
          }
          const moved = Math.hypot(player.position.x - last.x, player.position.y - last.y);
          last = { x: player.position.x, y: player.position.y };
          samples.push({
            at: (i + 1) * 100,
            ball: balls.length > 0,
            ballAge: balls[0] ? Math.round(balls[0].age) : null,
            buff: !!powerball(),
            speedBonus: powerball() ? Math.round(powerball().percent * 100) : null,
            movedSinceLast: Math.round(moved),
            toDummy: Math.round(player.position.dist(dummy.position)),
            spellState: q.state,
            stunnedNow: !!(player.buffs || []).find(b => b.constructor?.name === 'Stun'),
            ordered: player.basicAttack.target === dummy,
            destinationHeldByOrder:
              Math.round(player.destination.dist(dummy.position)) < 5 ||
              (!!player.basicAttack.target &&
                Math.round(player.destination.dist(player.position)) === 0),
            orderEnd: player.basicAttack.lastEnd,
            crash: sawCrash,
            dummyAirborne: dummy.buffs.some(b => b.constructor?.name === 'Airborne'),
          });
          if (!balls.length) break;
        }

        const end = samples[samples.length - 1];
        const firstStop = samples.find(s => s.movedSinceLast === 0) ?? null;
        return {
          label,
          attackRange,
          started,
          lifeTimeMs: RammusQ ? 4_000 : null,
          ballLastAgeMs: samples.filter(s => s.ball).map(s => s.ballAge).pop() ?? null,
          ballGoneAtMs: end.ball ? null : end.at,
          survivedFullLifetime: samples.filter(s => s.ball).length >= 39,
          contactHappened: sawCrash,
          crashVictim,
          dummyDamaged: Math.round(dummy.stats.maxHealth.value - dummy.stats.health.value),
          buffAtEnd: end.buff,
          totalTravel: Math.round(
            samples.reduce((sum, s) => sum + s.movedSinceLast, 0)
          ),
          stoppedMovingAtMs: firstStop ? firstStop.at : null,
          distanceToDummyAtEnd: end.toDummy,
          orderEnd: end.orderEnd,
          samples,
        };
      },
      { label, attackRange, orderAttack, stunAtMs }
    );

  report.control = await run('control: roll, move order only', 300, false);
  await page.screenshot({ path: `${OUT}-control.png` });
  report.rangedAttack = await run('ranged: roll, then attack order (range 300)', 300, true);
  await page.screenshot({ path: `${OUT}-ranged.png` });
  report.meleeAttack = await run('melee: roll, then attack order (range 50)', 50, true);
  await page.screenshot({ path: `${OUT}-melee.png` });
  // The policy, live: Powerball is INDEPENDENT, so crowd control does not end it.
  report.stunnedMidRoll = await run('stunned mid-roll, no attack order', 300, false, 800);
  await page.screenshot({ path: `${OUT}-stunned.png` });

  report.verdict = {
    powerballIsIndependent: {
      stunLanded: report.stunnedMidRoll.samples.some(s => s.stunnedNow),
      rollSurvivedTheStun: report.stunnedMidRoll.samples
        .filter(s => s.stunnedNow)
        .every(s => s.ball && s.buff),
      spellStateWhileRolling: [
        ...new Set(report.stunnedMidRoll.samples.map(s => s.spellState)),
      ],
    },
    // The arithmetic behind it: the attack controller parks the champion at
    // `attackRange + both bodies`, and the ball only reaches `its radius + the
    // victim's body`. The nearer of the two stopping distances is still outside
    // the ball, so an attack order can never walk a roller into contact — at any
    // attack range, melee included.
    attackOrderCanNeverReachContact:
      report.setup.attackReachAtRange50 > report.setup.ballReachToDummy,
    ballEverRemovedEarly: [report.rangedAttack, report.meleeAttack].some(
      r => !r.survivedFullLifetime
    ),
    contactPathTaken: [report.rangedAttack, report.meleeAttack].some(r => r.contactHappened),
    rollFrozenWhileStillNominallyActive: [report.rangedAttack, report.meleeAttack].map(r => ({
      run: r.label,
      ballStillAlive: r.survivedFullLifetime,
      buffStillOn: r.buffAtEnd,
      stoppedMovingAtMs: r.stoppedMovingAtMs,
      travelVsControl: `${r.totalTravel} vs ${report.control.totalTravel}`,
    })),
  };

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) process.exitCode = 1;
