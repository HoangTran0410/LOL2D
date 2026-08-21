/**
 * Does the reported 60->30 FPS drop with two heavily-stacked Cho'Gaths come
 * from health-bar rendering, from something else, or both?
 *
 * Repro: a player and one bot, both Cho'Gath, teleported next to each other so
 * the bot's own AI (autoAttack/autoCast) fights the player continuously —
 * that is what supplies the ongoing combat text and spell particles the real
 * report describes, without scripting either champion by hand. Two passes:
 *
 *   - baseline: 0 Feast stacks on either champion.
 *   - stacked:  LOL2D_STACKS (default 60) stacks applied to both via
 *     `ChoGath_R.setStackCount`, the same call the practice panel's cheat
 *     button makes.
 *
 * Both passes share the exact same setup (position, CPU throttle, warmup
 * length) up to the point stacks are applied, so the delta between them is
 * attributable to the stacks and nothing else.
 *
 * Same conditions as `docs/superpowers/specs/2026-08-16-mobile-render-budget-design.md`:
 * 844x390 viewport, deviceScaleFactor 3, Chrome 6x CPU throttle. Follows
 * `measure-frame-pacing.mjs`'s pattern of wrapping `game.draw` from inside
 * `page.evaluate` to sample real frame timing, extended here to also
 * instrument the specific candidate draw/update paths named in the report:
 * `Champion.prototype.drawHealthBar`, `AttackableUnit.prototype.drawBuffs`
 * (which is what actually calls `ChoGath_R_Growth.prototype.draw` once per
 * *stack instance*, not once per champion), `UnitCollisionSystem.resolve`,
 * `ObjectManager.draw` and `FogOfWar.draw`.
 *
 * CPU throttle is applied only for the measurement window itself — boot and
 * warmup run unthrottled so the two passes do not spend a different amount of
 * wall-clock time getting to the same state.
 *
 *   node tests/e2e/measure-chogath-stacks.mjs
 *   LOL2D_STACKS=99 LOL2D_MEASURE_MS=8000 node tests/e2e/measure-chogath-stacks.mjs
 */
import { CFG_KEY, PHONE_VIEWPORT, startHarness } from './harness.mjs';

const CPU_THROTTLE = Number(process.env.LOL2D_CPU_THROTTLE ?? 6);
const MEASURE_MS = Number(process.env.LOL2D_MEASURE_MS ?? 6000);
const WARMUP_MS = Number(process.env.LOL2D_WARMUP_MS ?? 2500);
const SETTLE_MS = Number(process.env.LOL2D_SETTLE_MS ?? 900);
const STACK_COUNT = Number(process.env.LOL2D_STACKS ?? 60);
const MINION_COUNT = Number(process.env.LOL2D_MINIONS ?? 0);
// Off by default: bot-vs-player combat is realistic (it's where the report's
// particles and combat text come from) but non-deterministic, which is noise
// when the point of a run is isolating the stack-count delta. Set to '1' for
// a scene that looks like the report; leave at '0' for a low-noise A/B.
const COMBAT = process.env.LOL2D_COMBAT === '1';
const BOT_OFFSET = 140;

const pregameConfig = () => ({
  player: {
    mode: 'champion',
    championName: "Cho'Gath",
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: [],
  },
  playerTeam: 'team-blue',
  ai: {
    count: 1,
    autoMove: COMBAT,
    autoAttack: COMBAT,
    autoCast: COMBAT,
    bots: [
      {
        mode: 'champion',
        championName: "Cho'Gath",
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: [],
      },
    ],
    botTeams: ['team-red'],
    botBehaviours: [{ autoMove: COMBAT, autoAttack: COMBAT, autoCast: COMBAT, difficulty: 'normal' }],
  },
  rules: { cooldownReductionPercent: 0, manaFree: false },
  world: { jungle: false, minions: false },
  cheats: {
    revealMap: false,
    debug: { routes: false, terrain: false, collision: false, vision: false, quadtree: false, fps: false },
    playerInvulnerable: true,
    botInvulnerable: [true],
  },
});

/** Runs inside the page. Positions the bot next to the player, clusters a wave
 *  of minions around both (a stand-in for the teamfight density the real
 *  report was screenshotted in) and, if asked, applies Feast stacks to both —
 *  then hands references to the second pass. */
async function setupScenario({ applyStacks, stackCount, warmupMs, settleMs, botOffset, minionCount }) {
  const game = window.__lol2d.scene.oScene.game;
  const player = game.player;
  const bot = game.director.bots()[0];
  if (!player || !bot) throw new Error('player or bot missing');

  bot.position.x = player.position.x + botOffset;
  bot.position.y = player.position.y;

  if (minionCount > 0) {
    const kinds = ['melee', 'melee', 'melee', 'ranged', 'ranged', 'ranged'];
    for (let i = 0; i < minionCount; i++) {
      const teamId = i % 2 === 0 ? 'team-blue' : 'team-red';
      const kind = kinds[i % kinds.length];
      const minion = game.minionSpawner.spawn({ teamId, lane: 'mid', kind });
      if (!minion) continue;
      const angle = (i / minionCount) * Math.PI * 2;
      const radius = 60 + (i % 5) * 20;
      minion.position.x = player.position.x + Math.cos(angle) * radius;
      minion.position.y = player.position.y + Math.sin(angle) * radius;
    }
  }

  await new Promise(resolve => setTimeout(resolve, warmupMs));

  const findR = champ => champ.spells.find(s => s.constructor.name === 'ChoGath_R');
  const rP = findR(player);
  const rB = findR(bot);
  if (!rP || !rB) throw new Error("ChoGath_R not found on one of the champions' spells");

  if (applyStacks) {
    rP.setStackCount(stackCount);
    rB.setStackCount(stackCount);
    await new Promise(resolve => setTimeout(resolve, settleMs));
  }

  window.__perf = { game, player, bot };
  return {
    playerStacks: rP.stackCount,
    botStacks: rB.stackCount,
    playerMaxHealth: player.stats.maxHealth.value,
    playerSize: player.stats.size.value,
    liveMinions: game.minionSpawner.minions.length,
    liveObjects: game.objectManager.objects.length,
    playerBuffCount: player.buffs.length,
    botBuffCount: bot.buffs.length,
  };
}

/** Runs inside the page, after CPU throttling is switched on from Node.
 *  Instruments the candidate hot paths, runs the measurement window, restores
 *  everything it patched, and returns a plain-object report. */
async function measure({ measureMs }) {
  const { game, player, bot } = window.__perf;

  const bucket = () => ({ calls: 0, ms: 0 });
  const buckets = {
    gameDraw: bucket(),
    gameUpdate: bucket(),
    objectManagerDraw: bucket(),
    unitCollisionResolve: bucket(),
    fogOfWarDraw: bucket(),
    drawHealthBar: bucket(),
    drawBuffs: bucket(),
    growthDraw: bucket(),
    updateBuffs: bucket(),
  };

  // `obj` is sometimes an actual instance (game, game.objectManager) and
  // sometimes a shared prototype (Champion.prototype, AttackableUnit.prototype)
  // patched once to cover every instance. Either way the wrapper must dispatch
  // through its own `this` at call time — binding `original` to `obj` up front
  // would nail every later call's `this` to the prototype object itself, which
  // is exactly wrong for a prototype-level wrap (e.g. `this.buffs` inside the
  // original `drawBuffs` would read the prototype's own `buffs`, not the
  // calling champion's).
  const restores = [];
  const wrap = (obj, key, into) => {
    const original = obj[key];
    obj[key] = function (...args) {
      const t0 = performance.now();
      const result = original.apply(this, args);
      into.ms += performance.now() - t0;
      into.calls++;
      return result;
    };
    restores.push(() => {
      obj[key] = original;
    });
  };

  const frames = [];
  const originalGameDraw = game.draw;
  game.draw = function (alpha) {
    const t0 = performance.now();
    const result = originalGameDraw.apply(this, [alpha]);
    frames.push({ t: t0, dur: performance.now() - t0 });
    return result;
  };
  restores.push(() => {
    game.draw = originalGameDraw;
  });

  wrap(game, 'update', buckets.gameUpdate);
  wrap(game.objectManager, 'draw', buckets.objectManagerDraw);
  wrap(game.objectManager.unitCollision, 'resolve', buckets.unitCollisionResolve);
  wrap(game.fogOfWar, 'draw', buckets.fogOfWarDraw);

  // Prototype-level: only two champions exist, but drawHealthBar/drawBuffs are
  // called on whichever prototype the instance actually resolves to, so
  // patching the shared prototype covers both the player (Champion) and the
  // bot (AIChampion, which inherits both methods unchanged).
  const championProto = Object.getPrototypeOf(player);
  const unitProto = Object.getPrototypeOf(championProto);
  wrap(championProto, 'drawHealthBar', buckets.drawHealthBar);
  wrap(unitProto, 'drawBuffs', buckets.drawBuffs);
  wrap(unitProto, 'updateBuffs', buckets.updateBuffs);

  const growth =
    player.buffs.find(b => b.constructor.name === 'ChoGath_R_Growth') ??
    bot.buffs.find(b => b.constructor.name === 'ChoGath_R_Growth');
  if (growth) wrap(Object.getPrototypeOf(growth), 'draw', buckets.growthDraw);

  await new Promise(resolve => setTimeout(resolve, measureMs));

  for (const restore of restores) restore();

  const gaps = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i].t - frames[i - 1].t);
  const durs = frames.map(f => f.dur);

  const sorted = arr => [...arr].sort((a, b) => a - b);
  const p95 = arr => {
    const s = sorted(arr);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
  };
  const mean = arr => (arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : 0);

  const summarize = b => ({
    calls: b.calls,
    totalMs: Number(b.ms.toFixed(2)),
    avgMs: b.calls ? Number((b.ms / b.calls).toFixed(4)) : 0,
  });

  return {
    frameCount: frames.length,
    fps: Number((frames.length / (measureMs / 1000)).toFixed(2)),
    frameGapP95: Number(p95(gaps).toFixed(2)),
    frameGapMean: Number(mean(gaps).toFixed(2)),
    drawDurP95: Number(p95(durs).toFixed(2)),
    drawDurMean: Number(mean(durs).toFixed(2)),
    bodyCount: game.objectManager.unitCollision.bodyCount,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, summarize(v)])),
  };
}

async function runScenario({ browser, url, applyStacks, label }) {
  const context = await browser.newContext({
    viewport: PHONE_VIEWPORT,
    deviceScaleFactor: 3,
  });
  await context.addInitScript(
    ({ key, cfg }) => localStorage.setItem(key, JSON.stringify(cfg)),
    { key: CFG_KEY, cfg: pregameConfig() }
  );
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });
  const cdp = await context.newCDPSession(page);

  await page.goto(url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(
    () => {
      const g = window.__lol2d?.scene?.oScene?.game;
      return !!(g?.objectManager && g.player && (g.director?.bots().length ?? 0) >= 1);
    },
    null,
    { timeout: 30_000 }
  );
  await page.waitForFunction(
    () => {
      const g = window.__lol2d.scene.oScene.game;
      return g.player.spells.length > 0 && g.director.bots()[0].spells.length > 0;
    },
    null,
    { timeout: 30_000 }
  );

  const setup = await page.evaluate(setupScenario, {
    applyStacks,
    stackCount: STACK_COUNT,
    warmupMs: WARMUP_MS,
    settleMs: SETTLE_MS,
    botOffset: BOT_OFFSET,
    minionCount: MINION_COUNT,
  });

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const result = await page.evaluate(measure, { measureMs: MEASURE_MS });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify({ setup, result }, null, 2));
  if (pageErrors.length) {
    console.log(`page errors (${pageErrors.length}):`);
    for (const err of pageErrors.slice(0, 10)) console.log(' ', err);
  }

  await context.close();
  return { setup, result, pageErrors };
}

const { url, browser, check, guard } = await startHarness({
  viewport: PHONE_VIEWPORT,
  deviceScaleFactor: 3,
});

await guard(async () => {
  const baseline = await runScenario({ browser, url, applyStacks: false, label: 'baseline (0 stacks)' });
  const stacked = await runScenario({
    browser,
    url,
    applyStacks: true,
    label: `stacked (${STACK_COUNT} stacks)`,
  });

  const summary = {
    baseline: { fps: baseline.result.fps, frameGapP95: baseline.result.frameGapP95 },
    stacked: { fps: stacked.result.fps, frameGapP95: stacked.result.frameGapP95 },
    fpsDelta: Number((baseline.result.fps - stacked.result.fps).toFixed(2)),
    frameGapP95Delta: Number(
      (stacked.result.frameGapP95 - baseline.result.frameGapP95).toFixed(2)
    ),
  };
  console.log('\n--- summary ---');
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n--- attribution: stacked minus baseline, total ms over the window ---');
  for (const key of Object.keys(baseline.result.buckets)) {
    const b = baseline.result.buckets[key].totalMs;
    const s = stacked.result.buckets[key].totalMs;
    console.log(`  ${key}: baseline ${b}ms -> stacked ${s}ms (delta ${Number((s - b).toFixed(2))}ms)`);
  }

  check(
    'no page errors in either scenario',
    baseline.pageErrors.length === 0 && stacked.pageErrors.length === 0,
    `${baseline.pageErrors.length} baseline, ${stacked.pageErrors.length} stacked`
  );
});
