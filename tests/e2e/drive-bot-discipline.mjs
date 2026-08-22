/**
 * Does a bot actually behave, in a real browser running a real match?
 *
 * Three things Vitest can see the *rules* of but not the emergent loop:
 *
 *  1. **A bot dropped into an enemy turret's reach gets out** — and **a bot
 *     seeded on the line outside one stays out.** The unit suites check
 *     `decidePosture` answers DISENGAGE and that `drive` picks a point outside
 *     the ring. They cannot see the four systems that fight over the
 *     destination every frame afterwards — `BasicAttackController` re-issuing
 *     `navigateTo(target)`, `AIChampion.updateAttackTargeting` handing the
 *     order back on its own 250ms clock, `PathAgent` re-planning, the turret
 *     shooting. These are the scripted probes, and they are the strong checks.
 *
 *     Two seedings, because bugs live on boundaries and the first probe drops
 *     the bot 150px past one. A bot parked *on* the keep-out ring with someone
 *     worth hitting just inside it is the harder case, and the one that
 *     shipped: the clamp treated a body standing on the ring as one already
 *     inside it, went quiet, and the bot walked into the guns, was pushed back
 *     out by DISENGAGE, and did it again four times a second.
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
/** How long a bot seeded on the keep-out ring is watched for pacing. */
const PACE_MS = 12_000;
/**
 * How often the seeded pair is put back where it started, in ms.
 *
 * One seeding is not a trial, it is an anecdote. A live match moves underneath
 * the probe — a wave arrives and the dive becomes legal, the bot's lane calls
 * it away, something hurts it and RETREAT owns the walk — so a single 8s watch
 * measured whichever of those happened to come first, and the broken code and
 * the fixed code scored 2 and 1. Re-seeding turns it into repeated trials of
 * the same question: put the bot on the line with someone worth hitting just
 * inside it, and see which way it goes.
 */
const RESEED_MS = 2_000;
/**
 * Clearance a bot keeps outside an enemy turret's reach — `TURRET_KEEP_OUT_PX`.
 *
 * Written out rather than imported: this half runs inside the page, against the
 * built bundle, where the module is not reachable by name. If the constant
 * moves, the seeding here stops sitting on the line and the probe quietly
 * becomes the one above.
 */
const KEEP_OUT_PX = 60;
/**
 * How many times a seeded bot may walk **into** the guns before it is pacing.
 *
 * Entries, not crossings: one excursion is two crossings, and a bot that dives
 * once behind its own wave and leaves is playing correctly, not pacing. Not
 * zero either — bodies separate and minions shove.
 *
 * Measured, not guessed. Over thirteen re-seeded trials the broken code scored
 * 3 entries and spent 16.67% of its samples inside the guns (198 of 240 samples
 * in SEARCH, 29 in DISENGAGE — the bot standing on the line and being rescued
 * off it); the fixed code scored 0 and 0%, with 229 of 241 samples in PUSH. The
 * share is the wider of the two margins, so both are checked.
 */
const MAX_GUN_LINE_ENTRIES = 2;
/** And the share of the watch it may spend in there. See above for the numbers. */
const MAX_SEEDED_INSIDE_PCT = 8;
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

const { url, page, report, check, guard, errors } = await startHarness();

await guard(async () => {
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

    // The enemy turret nearest the middle of the map — the outer one, which is
    // the only turret a bot ever actually reaches, and the only one whose
    // surroundings are open lane rather than base.
    //
    // Neither "the first in the array" (whichever row the map file lists first,
    // i.e. the far corner of the enemy base) nor "nearest the bot" works: bots
    // start on their own fountain, so both plant it somewhere no bot reaches by
    // playing and whose escape ray points into the back wall of a base.
    window.__outerEnemyTurret = of => {
      const middle = { x: game.mapSize / 2, y: game.mapSize / 2 };
      let turret = null;
      let nearest = Infinity;
      for (const candidate of game.turrets) {
        if (candidate.teamId === of.teamId || candidate.isDead) continue;
        const away = Math.hypot(candidate.position.x - middle.x, candidate.position.y - middle.y);
        if (away < nearest) {
          nearest = away;
          turret = candidate;
        }
      }
      return turret;
    };

    /** The unit vector from `turret` toward `of`'s own base — the side it arrives from. */
    window.__homewardOf = (turret, of) => {
      const home = game.fountains.find(f => f.teamId === of.teamId) ?? {
        position: { x: game.mapSize / 2, y: game.mapSize / 2 },
      };
      const dx = home.position.x - turret.position.x;
      const dy = home.position.y - turret.position.y;
      const span = Math.hypot(dx, dy) || 1;
      return { x: dx / span, y: dy / span };
    };

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
    const turret = window.__outerEnemyTurret(bot);
    if (!turret) return null;

    // Full health, so the retreat rules are not what answers — this has to be
    // the turret rule and nothing else. Drop it 150px inside the reach, on the
    // side facing its own base, which is the side a bot arrives from and the
    // side the way out runs back down.
    bot.stats.health.baseValue = bot.stats.maxHealth.value;
    const reach = turret.attackRange + bot.stats.size.value / 2;
    const homeward = window.__homewardOf(turret, bot);
    bot.teleportTo(
      turret.position.x + homeward.x * (reach - 150),
      turret.position.y + homeward.y * (reach - 150)
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

  // ------------------------- 1b. a bot seeded on the ring stays on the right side
  const seeded = await page.evaluate(
    ({ keepOut, avoid, reseedMs }) => {
      const game = window.__lol2d.scene.oScene.game;
      const bots = window.__bots().filter(b => !b.isDead);
      // Not the one probe 1 planted, if there is another: that bot is still
      // walking its way out of a ring and its trace would be that escape.
      const bot = bots.find(b => b.id !== avoid && b.teamId) ?? bots[0];
      if (!bot) return null;
      const turret = window.__outerEnemyTurret(bot);
      if (!turret) return null;
      // Someone worth walking at, of the turret's own team. Parked rather than
      // played: the reported bug is a *stationary* low-health player holding
      // the ground under their turret, and a victim that wanders off turns the
      // probe into a measurement of the victim.
      const victim = bots.find(b => b.teamId === turret.teamId && b.id !== bot.id);
      if (!victim) return null;

      const reach = turret.attackRange + bot.stats.size.value / 2;
      const homeward = window.__homewardOf(turret, bot);
      const wasAuto = { move: victim._autoMove, cast: victim._autoCast };
      victim._autoMove = false;
      victim._autoCast = false;

      /**
       * One trial: the victim parked 60px inside the guns, the bot exactly on
       * the keep-out line — the point `escapePoint` and the clamp both answer
       * with, which is what made it the one place neither of them worked.
       *
       * Both at full health every time. A dive on a killable target is allowed
       * and would be the right answer, so it must not be what this is watching;
       * and a bot the match has hurt answers with RETREAT, which owns the walk
       * and is not the rule under test either.
       */
      const seed = () => {
        victim.stats.health.baseValue = victim.stats.maxHealth.value;
        victim.stopMovement?.();
        victim.teleportTo(
          turret.position.x + homeward.x * (reach - 60),
          turret.position.y + homeward.y * (reach - 60)
        );
        bot.stats.health.baseValue = bot.stats.maxHealth.value;
        bot.teleportTo(
          turret.position.x + homeward.x * (reach + keepOut),
          turret.position.y + homeward.y * (reach + keepOut)
        );
      };
      seed();

      const pace = {
        samples: 0,
        trials: 1,
        entries: 0,
        insideSamples: 0,
        minClearance: Infinity,
        maxClearance: -Infinity,
        postures: {},
        died: false,
      };
      window.__pace = pace;

      // Its own sampler rather than a branch inside the 10Hz one: that loop
      // measures the whole match and this one measures one seeded body, and
      // folding them together would mean the match half growing a mode for it.
      // Every trial starts outside by construction, so the first sample of one
      // can never be an entry.
      let wasInside = false;
      let frame = 0;
      const samplesPerTrial = Math.round(reseedMs / 100);
      const watch = () => {
        requestAnimationFrame(watch);
        if (game.paused || frame++ % 6 !== 0) return;
        if (bot.isDead) {
          pace.died = true;
          return;
        }
        pace.samples += 1;
        if (pace.samples % samplesPerTrial === 0) {
          seed();
          pace.trials += 1;
          wasInside = false;
          return;
        }
        pace.postures[bot.brain.posture] = (pace.postures[bot.brain.posture] ?? 0) + 1;
        const clearance =
          Math.hypot(turret.position.x - bot.position.x, turret.position.y - bot.position.y) -
          reach;
        pace.minClearance = Math.min(pace.minClearance, clearance);
        pace.maxClearance = Math.max(pace.maxClearance, clearance);
        const inside = clearance < 0;
        if (inside) pace.insideSamples += 1;
        if (inside && wasInside === false) pace.entries += 1;
        wasInside = inside;
      };
      requestAnimationFrame(watch);

      // Handed back so the probe can undo itself. A bot left parked for the
      // rest of the run is a bot the other team plays a man down against, and
      // the free-running half below would be measuring that rather than the
      // match: leaving it parked once put a stationary target under an enemy
      // turret for a minute and pushed the longest unbroken exposure from
      // 800ms to 5200ms, failing a check that had nothing to do with it.
      window.__releaseVictim = () => {
        victim._autoMove = wasAuto.move;
        victim._autoCast = wasAuto.cast;
      };

      return { bot: bot.id, victim: victim.id, reach: Math.round(reach) };
    },
    { keepOut: KEEP_OUT_PX, avoid: planted?.bot ?? null, reseedMs: RESEED_MS }
  );
  check('a bot could be seeded on an enemy turret’s keep-out line', Boolean(seeded));

  if (seeded) {
    await page.waitForTimeout(PACE_MS);
    const paced = await page.evaluate(() => {
      window.__releaseVictim?.();
      return window.__pace;
    });
    report.seededOnTheRing = {
      seconds: Math.round(PACE_MS / 1_000),
      samples: paced.samples,
      trials: paced.trials,
      walkedIntoTheGuns: paced.entries,
      insidePct: paced.samples ? +((paced.insideSamples / paced.samples) * 100).toFixed(2) : 0,
      minClearance: Math.round(paced.minClearance),
      maxClearance: Math.round(paced.maxClearance),
      postures: paced.postures,
      died: paced.died,
    };
    check(
      'a bot seeded on the ring does not pace in and out of the guns',
      paced.entries <= MAX_GUN_LINE_ENTRIES,
      `walked into the guns ${paced.entries}x in ${PACE_MS / 1_000}s`
    );
    check(
      'and spends no real time in there',
      report.seededOnTheRing.insidePct <= MAX_SEEDED_INSIDE_PCT,
      `${report.seededOnTheRing.insidePct}% of ${paced.samples} samples inside the guns`
    );
    check(
      'and does not die standing on it',
      !paced.died,
      `min clearance ${Math.round(paced.minClearance)}px`
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
});
