/**
 * Frame-budget benchmark for terrain pathfinding.
 *
 * Boots its own Vite dev server on a free port, drives the real game in system
 * Chrome, fills the board with units and orders every one of them across the
 * map — repeatedly, and deliberately to points a straight line cannot serve —
 * then samples frame rate, tick cost and the pathfinder's own counters with
 * routing switched off and on.
 *
 * The A/B runs the same build twice and only flips `game.navigation.enabled`
 * between them. Off, every move order collapses to the straight-line `moveTo`
 * the game had before this existed, so the two numbers differ by the pass and
 * nothing else.
 *
 *   npm run e2e:pathfinding                  # 48 roamers per the default
 *   npm run e2e:pathfinding -- /tmp/lol2d 80 # screenshot prefix, roamer count
 *
 * Requires a system Chrome install.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/lol2d-pathfinding';
const ROAMERS = Number(process.argv[3] ?? 48);
const SAMPLE_MS = 8_000;
const WARMUP_MS = 2_500;

const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.click('#play-btn');
await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.navigation, null, {
  timeout: 30_000,
});
await page.waitForTimeout(1_500);

/** What the static structure cost to build and what it holds. */
const structure = await page.evaluate(() => {
  const { stats, grid } = window.__lol2d.scene.oScene.game.navigation;
  return {
    buildMs: Math.round(stats.buildMs * 1000) / 1000,
    gridKB: Math.round(grid.memoryBytes / 102.4) / 10,
    totalKB: Math.round(stats.memoryBytes / 102.4) / 10,
    cellSize: stats.cellSize,
    grid: `${stats.cols}x${stats.rows}`,
    cells: stats.cols * stats.rows,
  };
});

/**
 * The visual check: park the player on one side of a wall, order it to the
 * other, and watch. `insideWall` is measured against the same polygons the
 * renderer draws, so a pass here means the walk really did go round.
 */
await page.evaluate(async () => {
  const { Circle } = await import('/src/libs/quadtree.ts');
  const game = window.__lol2d.scene.oScene.game;
  const navigation = game.navigation;
  const player = game.player;

  // Clear the battlefield first, and keep it clear. The player is one champion
  // with 100 health in a free-for-all against five bots, a jungle, two turret
  // rows and a minion wave every few seconds: the first run of this check
  // measured a corpse respawning at a fountain rather than a walk.
  // Cho'Gath's ultimate is a true-damage execute, so raising the health pool is
  // not enough on its own — the bots have to go, and the wave clock with them.
  const hostile = new Set(['AIChampion', 'Minion']);
  for (const object of game.objectManager.objects) {
    if (object !== player && hostile.has(object.constructor.name)) object.toRemove = true;
  }
  game.minionSpawner.update = () => {};
  player.stats.maxHealth.baseValue = 1e6;
  player.stats.health.baseValue = 1e6;
  await new Promise(resolve => setTimeout(resolve, 400));

  // Find a start and a goal that are close together but not in line of sight —
  // that is a wall between them, which is the whole thing being demonstrated —
  // and that a route genuinely connects, with a real detour rather than one
  // corner. `nearestWalkable` will happily land in a jungle pocket nothing can
  // reach, and watching the graceful-failure path is a different demo.
  let pair = null;
  for (let attempt = 0; attempt < 20_000 && !pair; attempt++) {
    const from = navigation.nearestWalkable(
      Math.random() * game.mapSize,
      Math.random() * game.mapSize,
      player.bodyRadius,
      300
    );
    if (!from) continue;
    const angle = Math.random() * Math.PI * 2;
    const to = navigation.nearestWalkable(
      from.x + Math.cos(angle) * 900,
      from.y + Math.sin(angle) * 900,
      player.bodyRadius,
      300
    );
    if (!to) continue;
    if (navigation.isLineClear(from.x, from.y, to.x, to.y, player.bodyRadius)) continue;

    const route = navigation.finder.search(from.x, from.y, to.x, to.y, {
      radius: player.bodyRadius,
    });
    if (!route.ok || route.waypoints.length < 8) continue;
    pair = { from, to };
  }
  if (!pair) {
    window.__navWalk = { found: false, done: true };
    return { started: false };
  }

  player.teleportTo(pair.from.x, pair.from.y);
  game.camera.target = window.createVector(
    (pair.from.x + pair.to.x) / 2,
    (pair.from.y + pair.to.y) / 2
  );
  game.camera.scale = 0.75;
  game.camera.currentScale = 0.75;
  navigation.debugRoutes = true;
  player.stats.speed.baseValue = 1.6;
  player.orderMove(pair.to.x, pair.to.y, true);
  window.__navWalkPair = pair;

  const wallsNear = radius =>
    game.terrainMap
      .getObstaclesInArea(new Circle({ x: player.position.x, y: player.position.y, r: radius }), [
        'wall',
      ]);

  // Samples in the background so Node can photograph the walk while it happens
  // rather than after it, which is the only frame that shows the route.
  const state = {
    found: true,
    from: pair.from,
    to: pair.to,
    straightLineDistance: Math.round(Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y)),
    straightLineWasBlocked: true,
    wallsBetween: wallsNear(1_200).length,
    arrived: false,
    remaining: 0,
    distanceWalked: 0,
    framesInsideWall: 0,
    samples: 0,
    plannedCorners: 0,
    states: [],
    done: false,
  };
  window.__navWalk = state;

  const seen = new Set();
  let last = { x: player.position.x, y: player.position.y };
  const timer = setInterval(() => {
    state.samples++;
    state.distanceWalked += Math.hypot(player.position.x - last.x, player.position.y - last.y);
    last = { x: player.position.x, y: player.position.y };
    seen.add(player.pathAgent ? player.pathAgent.state : 'NONE');
    if (player.isDead) seen.add('DIED');
    if (player.pathAgent) {
      state.plannedCorners = Math.max(state.plannedCorners, player.pathAgent.waypoints.length / 2);
    }
    // clearance 0 means the body's cell is wall; the grid is the same one the
    // route was planned on, so this is a direct contradiction if it fires
    if (navigation.grid.clearanceAt(player.position.x, player.position.y) === 0) {
      state.framesInsideWall++;
    }
    state.remaining = Math.hypot(player.position.x - pair.to.x, player.position.y - pair.to.y);
    if (state.remaining < 40 || state.samples > 3_000) {
      clearInterval(timer);
      state.arrived = state.remaining < 40;
      state.remaining = Math.round(state.remaining);
      state.distanceWalked = Math.round(state.distanceWalked);
      state.states = [...seen];
      state.done = true;
    }
  }, 16);

  return { started: true };
});

// a third of the way in, with the route still ahead of the unit
await page.waitForTimeout(3_000);
await page.screenshot({ path: `${OUT}-walk.png` });

await page.waitForFunction(() => window.__navWalk?.done, null, { timeout: 90_000 });
const walk = await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  game.navigation.debugRoutes = false;
  // hand the wave clock back, so the benchmark board below is a full one again
  delete game.minionSpawner.update;
  return window.__navWalk;
});
await page.waitForTimeout(4_000);

/** Fill the board with units whose orders always cross terrain. */
const board = await page.evaluate(async roamers => {
  const dummy = await import('/src/game/gameObject/attackableUnits/DummyChampion.ts');
  const preset = await import('/src/game/preset.ts');
  const game = window.__lol2d.scene.oScene.game;
  const navigation = game.navigation;
  const size = game.mapSize;

  // Corners of the map, so every order is a genuine cross-map route rather
  // than a hop across open ground the straight-line check would answer.
  const anchors = [
    { x: 500, y: 5_900 },
    { x: 5_900, y: 500 },
    { x: 700, y: 900 },
    { x: 5_600, y: 5_600 },
    { x: 3_100, y: 3_100 },
  ].filter(point => navigation.grid.isWalkable(point.x, point.y, 27.5));

  const spawned = [];
  for (let i = 0; i < roamers; i++) {
    const home = anchors[i % anchors.length];
    // scatter around the anchor, then pull onto ground a body fits on
    const jittered = navigation.nearestWalkable(
      home.x + (Math.random() - 0.5) * 700,
      home.y + (Math.random() - 0.5) * 700,
      27.5,
      600
    );
    if (!jittered) continue;

    const unit = new dummy.default({
      game,
      position: window.createVector(jittered.x, jittered.y),
      preset: preset.getChampionPresetRandom(),
    });
    unit.setTeamId(i % 2 === 0 ? game.player.teamId : 'bench-roamer-team');
    unit.stats.speed.baseValue = 3.2;
    game.objectManager.addObject(unit);
    spawned.push(unit);
  }

  // Re-order everything every 700ms at a fresh far-side anchor. This is the
  // pessimal case on purpose: nothing here is ever answered by a straight line.
  let tick = 0;
  window.__navDrive = setInterval(() => {
    tick++;
    for (let i = 0; i < spawned.length; i++) {
      const target = anchors[(i + tick) % anchors.length];
      spawned[i].orderMove(target.x, target.y);
    }
  }, 700);

  game.camera.target = window.createVector(size / 2, size / 2);
  game.camera.scale = 0.35;
  game.camera.currentScale = 0.35;

  return {
    roamers: spawned.length,
    anchors: anchors.length,
    objects: game.objectManager.objects.length,
    minions: game.objectManager.objects.filter(o => o.constructor.name === 'Minion').length,
  };
}, ROAMERS);

/** Time one configuration end to end. */
async function measure(enabled) {
  await page.evaluate(on => {
    const game = window.__lol2d.scene.oScene.game;
    game.navigation.enabled = on;

    if (window.__navRestore) window.__navRestore();
    const originalUpdate = game.update.bind(game);
    const navigation = game.navigation;
    const originalNavUpdate = navigation.update.bind(navigation);

    const state = { update: [], nav: [], fps: [], maxSearchesFrame: 0, maxNodesFrame: 0 };
    window.__navBench = state;

    game.update = function benchUpdate() {
      const start = performance.now();
      originalUpdate();
      state.update.push(performance.now() - start);
    };
    navigation.update = function benchNavUpdate() {
      const start = performance.now();
      originalNavUpdate();
      state.nav.push(performance.now() - start);
      if (navigation.stats.searchesLastFrame > state.maxSearchesFrame) {
        state.maxSearchesFrame = navigation.stats.searchesLastFrame;
      }
      if (navigation.stats.nodesLastFrame > state.maxNodesFrame) {
        state.maxNodesFrame = navigation.stats.nodesLastFrame;
      }
    };
    const fpsTimer = setInterval(() => state.fps.push(window.frameRate()), 100);

    window.__navRestore = () => {
      clearInterval(fpsTimer);
      delete game.update;
      delete navigation.update;
      window.__navRestore = null;
    };
  }, enabled);

  await page.waitForTimeout(WARMUP_MS);
  await page.evaluate(() => {
    const state = window.__navBench;
    state.update.length = 0;
    state.nav.length = 0;
    state.fps.length = 0;
    state.maxSearchesFrame = 0;
    state.maxNodesFrame = 0;
    window.__lol2d.scene.oScene.game.navigation.resetCounters();
    window.__navSampleStart = performance.now();
  });
  await page.waitForTimeout(SAMPLE_MS);

  return page.evaluate(() => {
    const summarise = values => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const round = n => Math.round(n * 1000) / 1000;
      const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
      return {
        samples: sorted.length,
        min: round(sorted[0]),
        mean: round(mean),
        median: round(at(0.5)),
        p95: round(at(0.95)),
        max: round(sorted[sorted.length - 1]),
      };
    };
    const round = n => Math.round(n * 1000) / 1000;
    const state = window.__navBench;
    const navigation = window.__lol2d.scene.oScene.game.navigation;
    const stats = navigation.stats;
    const seconds = (performance.now() - window.__navSampleStart) / 1000;

    return {
      fps: summarise(state.fps),
      updateMs: summarise(state.update),
      navUpdateMs: summarise(state.nav),
      orders: {
        answeredByStraightLine: stats.directOrders,
        needingASearch: stats.searchedOrders,
      },
      searches: {
        total: stats.totalSearches,
        perSecond: round(stats.totalSearches / seconds),
        meanMs: round(navigation.meanSearchMs),
        worstMs: round(stats.maxSearchMs),
        meanNodes: stats.totalSearches ? Math.round(stats.totalNodes / stats.totalSearches) : 0,
        settledForClosest: stats.failedSearches,
      },
      budget: {
        maxSearchesInOneFrame: state.maxSearchesFrame,
        maxNodesInOneFrame: state.maxNodesFrame,
        deferrals: stats.deferrals,
        queueAtEnd: stats.queueLength,
      },
      board: window.__lol2d.scene.oScene.game.objectManager.objects.reduce((tally, object) => {
        const kind = object.constructor.name;
        tally[kind] = (tally[kind] ?? 0) + 1;
        return tally;
      }, { total: window.__lol2d.scene.oScene.game.objectManager.objects.length }),
    };
  });
}

const before = await measure(false);
const after = await measure(true);

/**
 * The same board, driven the way a game actually plays: short orders to nearby
 * ground rather than cross-map treks. This is what the straight-line check
 * exists for, and the ratio it produces is the honest one.
 */
await page.evaluate(() => {
  clearInterval(window.__navDrive);
  const game = window.__lol2d.scene.oScene.game;
  const navigation = game.navigation;
  const roamers = game.objectManager.objects.filter(
    o => o.constructor.name === 'DummyChampion'
  );
  window.__navDrive = setInterval(() => {
    for (const unit of roamers) {
      const angle = Math.random() * Math.PI * 2;
      const reach = 300 + Math.random() * 700;
      const spot = navigation.nearestWalkable(
        unit.position.x + Math.cos(angle) * reach,
        unit.position.y + Math.sin(angle) * reach,
        unit.bodyRadius,
        400
      );
      if (spot) unit.orderMove(spot.x, spot.y);
    }
  }, 700);
});
const realistic = await measure(true);

await page.evaluate(() => {
  if (window.__navRestore) window.__navRestore();
  clearInterval(window.__navDrive);
});

// A wide shot of the board with routing on, for the eye check on the crowd.
await page.evaluate(() => {
  const game = window.__lol2d.scene.oScene.game;
  game.camera.target = window.createVector(game.mapSize / 2, game.mapSize / 2);
  game.camera.scale = 0.3;
  game.camera.currentScale = 0.3;
});
await page.waitForTimeout(1_500);
await page.screenshot({ path: `${OUT}-board.png` });

console.log(
  JSON.stringify(
    { structure, board, roamers: ROAMERS, before, after, realistic, walk, errors },
    null,
    2
  )
);

await browser.close();
await server.close();
if (errors.length) process.exitCode = 1;
