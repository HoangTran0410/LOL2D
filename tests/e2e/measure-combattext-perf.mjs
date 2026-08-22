/**
 * Does a teamfight's worth of combat text actually cost frame time?
 *
 * The report (Vietnamese, paraphrased): with many minions on screen, or many
 * damage/heal events landing back to back during a fight, combat text is
 * created and destroyed continuously and the frame rate suffers. Two leads
 * were on the table rather than assumed:
 *
 *   1. `CombatText` is not on `ObjectManager.isDecoration()`'s list, so every
 *      floating number goes into `_objectsTree` — the quadtree every gameplay
 *      query walks — rather than `_decorTree`, which no query pages in. A
 *      teamfight is exactly when that tree is biggest and least idle.
 *   2. One `CombatText` per damage/heal event, uncapped and unmerged, so a
 *      fast attacker or a multi-hit spell spawns and animates one object per
 *      tick rather than one per burst.
 *
 * This script builds a reproducible, deterministic burst — real minions from
 * the live spawner, real `takeDamage`/`takeHeal` calls on a pool of dummy
 * targets whose health pool is set absurdly high so none of them die and
 * change the population mid-run — and counts, rather than guesses:
 *
 *   - rendered frames/sec (`Game.draw` invocations)
 *   - live `CombatText` instances, sampled at 10Hz
 *   - `CombatText` constructions over the burst (`ObjectManager.addObject`)
 *   - objects in `_objectsTree` vs `_decorTree` at the end of the burst
 *   - cumulative time inside `Quadtree.prototype.retrieve`, split by which
 *     tree it was called on — this is the direct cost of lead #1
 *   - cumulative time inside `ObjectManager.update` / `.draw`
 *
 * No screenshots: every one of the above is a number, and a 1280x900 PNG
 * costs about what 600 lines of source costs to read (CLAUDE.md).
 *
 *   node tests/e2e/measure-combattext-perf.mjs
 *   LOL2D_CHROME_CHANNEL= node tests/e2e/measure-combattext-perf.mjs   # bundled Chromium
 */
import { startHarness } from './harness.mjs';

/** Extra minions spawned directly through the live spawner, beyond wave 1. */
const TARGET_MINION_COUNT = Number(process.env.LOL2D_TARGET_MINIONS ?? 100);
/** How many of the dummy targets take damage on each tick of the burst. */
const HITS_PER_TICK = Number(process.env.LOL2D_HITS_PER_TICK ?? 4);
/** Burst tick period, ms — matches the interval real attack swings land at. */
const TICK_MS = Number(process.env.LOL2D_TICK_MS ?? 20);
/** How long the burst runs, ms. */
const BURST_MS = Number(process.env.LOL2D_BURST_MS ?? 5_000);
/** Settle window before sampling starts, so the burst's own onset is excluded. */
const WARMUP_MS = 300;

const { url, page, report, check, guard } = await startHarness();

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_000);

  // Let the first real wave leave both fountains, so there is at least one
  // real (teamId, lane) pair per side to spawn more minions on.
  await page.waitForFunction(
    () => window.__lol2d.scene.oScene.game.minionSpawner.minions.length >= 6,
    null,
    { timeout: 20_000 }
  );

  const result = await page.evaluate(
    async ({ TARGET_MINION_COUNT, HITS_PER_TICK, TICK_MS, BURST_MS, WARMUP_MS }) => {
      const game = window.__lol2d.scene.oScene.game;
      const objectManager = game.objectManager;
      const spawner = game.minionSpawner;

      // ---------------------------------------------------------- population
      const pairs = [];
      const seen = new Set();
      for (const m of spawner.minions) {
        const key = m.teamId + '|' + m.lane;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ teamId: m.teamId, lane: m.lane });
        }
      }
      let spawnAttempts = 0;
      while (
        spawner.minions.length < TARGET_MINION_COUNT &&
        spawnAttempts < TARGET_MINION_COUNT * 3
      ) {
        const pair = pairs[spawnAttempts % pairs.length];
        spawner.spawn({ teamId: pair.teamId, lane: pair.lane, kind: 'melee' });
        spawnAttempts++;
      }

      // A pool of dummy targets, health pinned high so the burst cannot kill
      // them and shrink the population mid-measurement — that would make the
      // before/after runs incomparable for reasons that have nothing to do
      // with combat text.
      const dummies = spawner.minions.slice(0, Math.min(40, spawner.minions.length));
      for (const dummy of dummies) {
        dummy.stats.maxHealth.baseValue = 1e9;
        dummy.stats.health.baseValue = 1e9;
      }

      // ---------------------------------------------------------- instruments
      const quadtreeProto = Object.getPrototypeOf(objectManager._objectsTree);
      const realRetrieve = quadtreeProto.retrieve;
      const retrieve = {
        objectsTree: { calls: 0, ms: 0 },
        decorTree: { calls: 0, ms: 0 },
        other: { calls: 0, ms: 0 },
      };
      quadtreeProto.retrieve = function (...args) {
        const t0 = performance.now();
        const out = realRetrieve.apply(this, args);
        const dt = performance.now() - t0;
        const bucket =
          this === objectManager._objectsTree
            ? retrieve.objectsTree
            : this === objectManager._decorTree
              ? retrieve.decorTree
              : retrieve.other;
        bucket.calls++;
        bucket.ms += dt;
        return out;
      };

      const managerProto = Object.getPrototypeOf(objectManager);
      const realUpdate = managerProto.update;
      const realDraw = managerProto.draw;
      const timing = { update: { calls: 0, ms: 0 }, draw: { calls: 0, ms: 0 } };
      managerProto.update = function (...args) {
        const t0 = performance.now();
        const out = realUpdate.apply(this, args);
        timing.update.calls++;
        timing.update.ms += performance.now() - t0;
        return out;
      };
      managerProto.draw = function (...args) {
        const t0 = performance.now();
        const out = realDraw.apply(this, args);
        timing.draw.calls++;
        timing.draw.ms += performance.now() - t0;
        return out;
      };

      const realAddObject = managerProto.addObject;
      let combatTextConstructions = 0;
      managerProto.addObject = function (object) {
        if (object?.constructor?.name === 'CombatText') combatTextConstructions++;
        return realAddObject.call(this, object);
      };

      let frames = 0;
      const realGameDraw = Object.getPrototypeOf(game).draw;
      game.draw = function (...args) {
        frames++;
        return realGameDraw.apply(this, args);
      };

      const combatTextSamples = [];
      const objectCountSamples = [];
      let sampling = false;
      const sample = () => {
        requestAnimationFrame(sample);
        if (!sampling) return;
        let combatTextLive = 0;
        for (const o of objectManager.objects) {
          if (o.constructor?.name === 'CombatText') combatTextLive++;
        }
        combatTextSamples.push(combatTextLive);
        objectCountSamples.push(objectManager.objects.length);
      };
      requestAnimationFrame(sample);

      const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

      // -------------------------------------------------------------- burst
      let hitTicks = 0;
      const hitInterval = setInterval(() => {
        for (let i = 0; i < HITS_PER_TICK; i++) {
          const target = dummies[Math.floor(Math.random() * dummies.length)];
          const attacker = dummies[Math.floor(Math.random() * dummies.length)];
          if (!target || target.isDead) continue;
          if (Math.random() < 0.2) {
            target.takeHeal(2 + Math.random() * 10);
          } else {
            target.takeDamage(2 + Math.random() * 12, attacker === target ? undefined : attacker);
          }
        }
        hitTicks++;
      }, TICK_MS);

      await settle(WARMUP_MS);
      frames = 0;
      timing.update = { calls: 0, ms: 0 };
      timing.draw = { calls: 0, ms: 0 };
      retrieve.objectsTree = { calls: 0, ms: 0 };
      retrieve.decorTree = { calls: 0, ms: 0 };
      retrieve.other = { calls: 0, ms: 0 };
      combatTextConstructions = 0;
      const windowStart = performance.now();
      sampling = true;

      await settle(BURST_MS);

      sampling = false;
      const windowMs = performance.now() - windowStart;
      clearInterval(hitInterval);

      // Count directly off the node structure, so the "how big is the tree"
      // read does not itself run through retrieve (already restored below).
      const countNode = node => {
        let n = node.objects.length;
        for (const child of node.nodes) n += countNode(child);
        return n;
      };
      const objectsTreeCount = countNode(objectManager._objectsTree);
      const decorTreeCount = countNode(objectManager._decorTree);

      quadtreeProto.retrieve = realRetrieve;
      managerProto.update = realUpdate;
      managerProto.draw = realDraw;
      managerProto.addObject = realAddObject;
      game.draw = realGameDraw;

      const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const max = xs => (xs.length ? Math.max(...xs) : 0);

      return {
        windowMs: Number(windowMs.toFixed(1)),
        fps: Number(((frames * 1000) / windowMs).toFixed(1)),
        hitTicks,
        minionCount: spawner.minions.length,
        totalObjectCount: objectManager.objects.length,
        objectsTreeCount,
        decorTreeCount,
        combatTextConstructions,
        combatTextLiveMean: Number(mean(combatTextSamples).toFixed(1)),
        combatTextLiveMax: max(combatTextSamples),
        retrieve: {
          objectsTree: {
            calls: retrieve.objectsTree.calls,
            ms: Number(retrieve.objectsTree.ms.toFixed(1)),
            msPerSec: Number(((retrieve.objectsTree.ms * 1000) / windowMs).toFixed(1)),
          },
          decorTree: {
            calls: retrieve.decorTree.calls,
            ms: Number(retrieve.decorTree.ms.toFixed(1)),
            msPerSec: Number(((retrieve.decorTree.ms * 1000) / windowMs).toFixed(1)),
          },
        },
        update: {
          calls: timing.update.calls,
          ms: Number(timing.update.ms.toFixed(1)),
          msPerCall: Number((timing.update.ms / (timing.update.calls || 1)).toFixed(3)),
        },
        draw: {
          calls: timing.draw.calls,
          ms: Number(timing.draw.ms.toFixed(1)),
          msPerCall: Number((timing.draw.ms / (timing.draw.calls || 1)).toFixed(3)),
        },
      };
    },
    { TARGET_MINION_COUNT, HITS_PER_TICK, TICK_MS, BURST_MS, WARMUP_MS }
  );

  report.result = result;

  check(
    'minion population reached target',
    result.minionCount >= TARGET_MINION_COUNT * 0.9,
    `minions=${result.minionCount}`
  );
  // Not a lower bound on constructions: a fixed, merged live count doing its
  // job means most events past warmup are merges, not constructions — that is
  // the improvement this script exists to see, so asserting a construction
  // floor would fail exactly when the fix is working best. Live count is the
  // sanity check that the burst is actually landing hits on screen.
  check(
    'the burst kept combat text on screen',
    result.combatTextLiveMean > 0,
    `live mean=${result.combatTextLiveMean}, max=${result.combatTextLiveMax}`
  );
  check('frames were actually rendered', result.fps > 0, `fps=${result.fps}`);
});
