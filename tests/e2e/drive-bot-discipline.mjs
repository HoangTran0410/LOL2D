/**
 * Does a bot actually behave, in a real browser running a real match?
 *
 * Three things Vitest can see the *rules* of but not the emergent loop:
 *
 *  1. **A bot dropped into an enemy turret's reach gets out.** The unit suites
 *     check `decidePosture` answers DISENGAGE and that `drive` picks a point
 *     outside the ring. They cannot see the four systems that fight over the
 *     destination every frame afterwards — `BasicAttackController` re-issuing
 *     `navigateTo(target)`, `AIChampion.updateAttackTargeting` handing the
 *     order back on its own 250ms clock, `PathAgent` re-planning, the turret
 *     shooting. This is the scripted probe, and it is the strong check.
 *  2. **A bot never fires an ability at nobody.** Reported from a real match:
 *     an ultimate pressed every cast interval while walking an empty lane.
 *     `BotBrain.cast` is wrapped, so every press is counted with the target it
 *     was aimed at — the count, not a screenshot, is the evidence.
 *  3. **A wave musters between the base turrets, not inside the fountain.**
 *     `MinionSpawner.spawn` is wrapped the same way.
 *
 * Ends in a numeric summary and nothing else: a screenshot costs about what 600
 * lines of source costs to read, and none of the above is a question about how
 * something looks (CLAUDE.md).
 *
 *   node tests/e2e/drive-bot-discipline.mjs
 *   LOL2D_CHROME_CHANNEL= node tests/e2e/drive-bot-discipline.mjs   # bundled Chromium
 */
import { startHarness } from './harness.mjs';

/** How long the free-running half watches the match, in wall-clock ms. */
const OBSERVE_MS = Number(process.env.LOL2D_OBSERVE_MS ?? 60_000);
/** How long a bot planted under a turret is given to walk back out. */
const ESCAPE_MS = 6_000;
/**
 * The longest a single bot may stay inside an enemy turret's reach, unbroken.
 *
 * A *share* of samples is the wrong measure and the first version of this used
 * one: sieging a turret behind your own wave means standing in its reach and
 * being shot by it, which is how a turret is taken, so the share went up
 * exactly when the bots were playing well. What "it stood there and died" means
 * is a long unbroken run, and a turret fires every 1300ms for 12 damage against
 * a ~100 pool — so five seconds is about 46 damage, and anything past that is a
 * bot that has stopped noticing.
 */
const MAX_UNBROKEN_EXPOSURE_MS = 5_000;
/** Sampler period: every 6th frame at 60fps. */
const SAMPLE_MS = 100;

const { url, page, report, check, finish, errors } = await startHarness();

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_000);

  // ---------------------------------------------------------------- probes
  await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const probe = {
      samples: 0,
      botSamples: 0,
      insideRing: 0,
      underFire: 0,
      longestInsideRing: 0,
      longestUnderFire: 0,
      postures: {},
      casts: 0,
      castsWithNoTarget: 0,
      ghostCasts: 0,
      ultimateCastsWithNoTarget: 0,
      minions: [],
    };
    window.__probe = probe;

    const bots = () => {
      const out = [];
      for (const o of game.objectManager.objects) if (o?.isBot && o.brain) out.push(o);
      for (const o of game.objectManager._objectToBeAdd ?? []) if (o?.isBot && o.brain) out.push(o);
      return out;
    };
    window.__bots = bots;

    // Every ability a bot presses, with the target it was aimed at. `private`
    // in TypeScript is a compile-time word only, so the method is right here.
    const brainProto = Object.getPrototypeOf(bots()[0]?.brain ?? {});
    const realCast = brainProto.cast;
    if (realCast) {
      brainProto.cast = function (choice, aim, nowMs, target) {
        probe.casts += 1;
        if (!target) {
          probe.castsWithNoTarget += 1;
          // SEARCH is the one posture where a targetless cast is the *point*:
          // `chooseGhostSpell` throws an area spell at a position an enemy was
          // standing on under a second ago. Counted apart, so the assertion
          // below is about firing at nobody rather than about guessing well.
          if (this.posture === 'SEARCH') probe.ghostCasts += 1;
          // Slot 4 is R. `SpellHotKeys` is [A, Q, W, E, R, D, F].
          if (choice?.slotIndex === 4) probe.ultimateCastsWithNoTarget += 1;
        }
        return realCast.call(this, choice, aim, nowMs, target);
      };
    }

    // Where each wave actually forms up.
    const spawner = game.minionSpawner;
    const spawnerProto = Object.getPrototypeOf(spawner);
    const realSpawn = spawnerProto.spawn;
    spawnerProto.spawn = function (entry) {
      const minion = realSpawn.call(this, entry);
      if (minion && probe.minions.length < 200) {
        const fountain = this.fountainFor(minion.teamId);
        probe.minions.push({
          teamId: minion.teamId,
          lane: minion.lane,
          waypointIndex: minion.waypointIndex,
          fromFountain: fountain
            ? Math.hypot(
                minion.position.x - fountain.position.x,
                minion.position.y - fountain.position.y
              )
            : -1,
          fountainRadius: fountain ? fountain.radius : -1,
        });
      }
      return minion;
    };

    // 10Hz sampler on the browser's own frame clock, so a 60-second watch costs
    // one `evaluate` at each end rather than three hundred round trips.
    const streaks = new Map();
    let frame = 0;
    const sample = () => {
      requestAnimationFrame(sample);
      if (game.paused || frame++ % 6 !== 0) return;
      probe.samples += 1;
      for (const bot of bots()) {
        if (bot.isDead) {
          streaks.delete(bot.id);
          continue;
        }
        probe.botSamples += 1;
        const posture = bot.brain.posture;
        probe.postures[posture] = (probe.postures[posture] ?? 0) + 1;

        let inside = false;
        let shotAt = false;
        for (const turret of game.turrets) {
          if (turret.teamId === bot.teamId || turret.isDead) continue;
          const reach = turret.attackRange + bot.stats.size.value / 2;
          const away = Math.hypot(
            turret.position.x - bot.position.x,
            turret.position.y - bot.position.y
          );
          if (away > reach) continue;
          inside = true;
          if (turret.target === bot) shotAt = true;
          break;
        }

        if (inside) probe.insideRing += 1;
        if (shotAt) probe.underFire += 1;
        // The unbroken run, which is what "it stood there" actually means.
        const run = streaks.get(bot.id) ?? { inside: 0, fire: 0 };
        run.inside = inside ? run.inside + 1 : 0;
        run.fire = shotAt ? run.fire + 1 : 0;
        streaks.set(bot.id, run);
        if (run.inside > probe.longestInsideRing) probe.longestInsideRing = run.inside;
        if (run.fire > probe.longestUnderFire) probe.longestUnderFire = run.fire;
      }
    };
    requestAnimationFrame(sample);
  });

  // ------------------------------------------------- 3. where a wave musters
  await page.waitForFunction(() => window.__probe.minions.length >= 12, null, { timeout: 60_000 });
  const wave = await page.evaluate(() => window.__probe.minions.slice(0, 24));
  const outsideFountain = wave.filter(m => m.fromFountain > m.fountainRadius).length;
  const backwards = wave.filter(m => m.waypointIndex < 1).length;
  report.wave = {
    sampled: wave.length,
    outsideFountain,
    backwards,
    fromFountainMin: Math.round(Math.min(...wave.map(m => m.fromFountain))),
    fromFountainMax: Math.round(Math.max(...wave.map(m => m.fromFountain))),
    startWaypoints: [...new Set(wave.map(m => `${m.lane}:${m.waypointIndex}`))].sort(),
  };
  check(
    'a wave musters outside its own fountain',
    outsideFountain === wave.length,
    `${outsideFountain}/${wave.length} clear of the platform`
  );
  check('no minion is sent back to waypoint 0', backwards === 0, `${backwards} were`);

  // --------------------------------------- 1. a bot planted under a turret leaves
  const planted = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const bot = window.__bots().find(b => !b.isDead);
    if (!bot) return null;
    // The enemy turret nearest the middle of the map — the outer one, which is
    // the only turret a bot ever actually reaches, and the only one whose
    // surroundings are open lane rather than base.
    //
    // Neither "the first in the array" (whichever row the map file lists first,
    // i.e. the far corner of the enemy base) nor "nearest the bot" works: bots
    // start on their own fountain, so both plant it somewhere no bot reaches by
    // playing and whose escape ray points into the back wall of a base.
    const middle = { x: game.mapSize / 2, y: game.mapSize / 2 };
    let turret = null;
    let nearest = Infinity;
    for (const candidate of game.turrets) {
      if (candidate.teamId === bot.teamId || candidate.isDead) continue;
      const away = Math.hypot(candidate.position.x - middle.x, candidate.position.y - middle.y);
      if (away < nearest) {
        nearest = away;
        turret = candidate;
      }
    }
    if (!turret) return null;

    // Full health, so the retreat rules are not what answers — this has to be
    // the turret rule and nothing else. Drop it 150px inside the reach.
    bot.stats.health.baseValue = bot.stats.maxHealth.value;
    const reach = turret.attackRange + bot.stats.size.value / 2;
    // On the side facing its own base, which is the side a bot arrives from and
    // the side the way out runs back down.
    const home = game.fountains.find(f => f.teamId === bot.teamId) ?? { position: middle };
    const dx = home.position.x - turret.position.x;
    const dy = home.position.y - turret.position.y;
    const span = Math.hypot(dx, dy) || 1;
    bot.teleportTo(
      turret.position.x + (dx / span) * (reach - 150),
      turret.position.y + (dy / span) * (reach - 150)
    );
    return {
      bot: bot.id,
      at: { x: bot.position.x, y: bot.position.y },
      turret: { x: turret.position.x, y: turret.position.y },
      reach,
      startedAway: Math.hypot(
        turret.position.x - bot.position.x,
        turret.position.y - bot.position.y
      ),
    };
  });
  check('a bot could be planted under an enemy turret', Boolean(planted));

  if (planted) {
    await page.waitForTimeout(ESCAPE_MS);
    const escaped = await page.evaluate(
      ({ id, from }) => {
        const game = window.__lol2d.scene.oScene.game;
        const bot = window.__bots().find(b => b.id === id);
        if (!bot) return null;
        let nearest = Infinity;
        for (const turret of game.turrets) {
          if (turret.teamId === bot.teamId || turret.isDead) continue;
          const reach = turret.attackRange + bot.stats.size.value / 2;
          const away = Math.hypot(
            turret.position.x - bot.position.x,
            turret.position.y - bot.position.y
          );
          nearest = Math.min(nearest, away - reach);
        }
        return {
          dead: bot.isDead,
          clearance: nearest,
          posture: bot.brain.posture,
          // How far it actually got, so a slow escape is distinguishable from one
          // that never started — the two need different fixes.
          travelled: Math.hypot(bot.position.x - from.x, bot.position.y - from.y),
        };
      },
      { id: planted.bot, from: planted.at }
    );

    report.plantedUnderTurret = {
      startedInsideBy: Math.round(planted.reach - planted.startedAway),
      ...(escaped
        ? {
            clearanceAfter: Math.round(escaped.clearance),
            posture: escaped.posture,
            died: escaped.dead,
          }
        : { gone: true }),
    };
    check(
      'it walks back out of the turret ring within 6s',
      Boolean(escaped) && !escaped.dead && escaped.clearance > 0,
      escaped
        ? `clearance ${Math.round(escaped.clearance)}px, died=${escaped.dead}`
        : 'bot vanished'
    );
  }

  // ------------------------------------------- 2. the free-running observation
  // Zeroed first: the planted bot above spends its whole escape inside a ring
  // and under fire by construction, so leaving those samples in would make the
  // exposure figure a measure of the probe rather than of the match.
  await page.evaluate(() => {
    const probe = window.__probe;
    probe.samples = 0;
    probe.botSamples = 0;
    probe.insideRing = 0;
    probe.underFire = 0;
    probe.longestInsideRing = 0;
    probe.longestUnderFire = 0;
    probe.postures = {};
    probe.casts = 0;
    probe.castsWithNoTarget = 0;
    probe.ghostCasts = 0;
    probe.ultimateCastsWithNoTarget = 0;
  });
  await page.waitForTimeout(OBSERVE_MS);
  const probe = await page.evaluate(() => window.__probe);

  const exposure = probe.botSamples ? probe.insideRing / probe.botSamples : 0;
  const underFire = probe.botSamples ? probe.underFire / probe.botSamples : 0;
  const longestInsideMs = probe.longestInsideRing * SAMPLE_MS;
  const longestUnderFireMs = probe.longestUnderFire * SAMPLE_MS;
  report.observed = {
    seconds: Math.round(OBSERVE_MS / 1_000),
    botSamples: probe.botSamples,
    insideRingPct: +(exposure * 100).toFixed(2),
    underFirePct: +(underFire * 100).toFixed(2),
    longestUnbrokenInsideMs: longestInsideMs,
    longestUnbrokenUnderFireMs: longestUnderFireMs,
    casts: probe.casts,
    castsWithNoTarget: probe.castsWithNoTarget,
    ofThoseGhostCastsAtALastKnownPosition: probe.ghostCasts,
    ultimateCastsWithNoTarget: probe.ultimateCastsWithNoTarget,
    postures: probe.postures,
  };

  check(
    'no bot ever presses its ultimate at nobody',
    probe.ultimateCastsWithNoTarget === 0,
    `${probe.ultimateCastsWithNoTarget} of ${probe.casts} casts`
  );
  check(
    'no bot stays inside a turret ring',
    longestInsideMs <= MAX_UNBROKEN_EXPOSURE_MS,
    `longest unbroken ${longestInsideMs}ms (${(exposure * 100).toFixed(2)}% of samples)`
  );
  check(
    'no bot is left standing as a turret target',
    longestUnderFireMs <= MAX_UNBROKEN_EXPOSURE_MS,
    `longest unbroken ${longestUnderFireMs}ms (${(underFire * 100).toFixed(2)}% of samples)`
  );
  check('bots did something at all', probe.casts > 0, `${probe.casts} casts`);
  check('no runtime errors', errors.length === 0, errors[0]);
} finally {
  await finish();
}
