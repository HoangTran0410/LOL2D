/**
 * Task 10 of the content-pack extraction: a player can choose a map, and the
 * match they start is actually the one they chose.
 *
 * Everything up to this task is proven in Vitest, which runs on
 * `environment: 'node'` — no renderer, no p5, no DOM. That suite can check
 * that `MatchConfigSource.setMap` writes the qualified id and that
 * `PackRegistry.maps()` lists both installed maps; it cannot click a real
 * `<select>` in a real browser and watch a real `Game` boot onto real
 * geometry. This script is that last mile.
 *
 * Built on `tests/e2e/harness.mjs` — Vite server, browser, page-error
 * capture, `check()`/`report`/`guard()`. `guard()` is new (this script is its
 * first user): it runs the whole check body and guarantees the harness's own
 * `finish()` is called exactly once, including on a throw partway through —
 * see its doc comment in `harness.mjs` for the bug the older
 * `try { …checks… } finally { await finish(); }` shape hid.
 *
 * ## What "the world is actually the chosen map" means here
 *
 * Summoner's Rift and Proving Grounds differ in three facts a running
 * `Game` exposes directly, with no screenshot needed:
 *
 *   | fact                        | Summoner's Rift | Proving Grounds |
 *   |------------------------------|-----------------|------------------|
 *   | `game.mapSize`               | 6400             | 2400             |
 *   | `game.terrainMap.obstacles.length` (wall+bush+water polygons) | 395 (329+40+26) | 5 |
 *   | `game.turrets.length`        | 22 (11+11)       | 3 (1 amber + 2 jade) |
 *
 * Every number above is read from the source, not guessed: `assets/json/
 * summoner_map.json`'s own `wall`/`bush`/`water`/`turret1`/`turret2` arrays
 * for Summoner's Rift, `packs/reference/provingGroundsGeometry.ts`'s `wall`
 * array and `slots.structure` for Proving Grounds. A picker that silently
 * kept booting the bundled map regardless of the pick would still report
 * *some* numbers; asserting on three independent, source-derived facts
 * (rather than one) is what makes that failure mode visible instead of
 * accidentally matching.
 *
 * ## The checks, in order
 *
 *   1. a fresh config with no map id at all boots Summoner's Rift — the
 *      migration case `PregameConfig.sanitizePregameConfig` promises;
 *   2. a config naming a map nothing installs (a stale or removed pick)
 *      still boots — onto the first available map — rather than bricking the
 *      match, which is `GameScene.startGame()`'s own fallback;
 *   3. the Trận đấu tab's map picker lists both installed maps by name;
 *   4. picking "Sân Thử Nghiệm" (Proving Grounds) and starting stores its
 *      *qualified* id, `reference:proving-grounds` — never the bare local id
 *      `proving-grounds`, which is exactly the shape of batch 2's last bug
 *      (a picker path that degraded silently, showing "?" and rerolling to
 *      something random at match start);
 *   5. that match's world is actually Proving Grounds', by every fact above;
 *   6. no page errors the whole time.
 *
 * `ai.count: 0` and `world: { jungle: false, minions: false }` in every
 * seeded config, the same shape `verify-pack-champion.mjs` uses: nothing else
 * on the map can raise a page error while the checks read off `game`, and
 * none of that is the behaviour under test.
 *
 *   node tests/e2e/verify-map-picker.mjs
 *   LOL2D_CHROME_CHANNEL= node tests/e2e/verify-map-picker.mjs   # bundled Chromium
 */
import { CFG_KEY, startHarness } from './harness.mjs';

const SUMMONERS_RIFT_ID = 'riot:summoners-rift';
const PROVING_GROUNDS_ID = 'reference:proving-grounds';

/** Source-derived, per this file's own header table. */
const EXPECTED = {
  [SUMMONERS_RIFT_ID]: { mapSize: 6400, terrainPolygons: 329 + 40 + 26, structures: 11 + 11 },
  [PROVING_GROUNDS_ID]: { mapSize: 2400, terrainPolygons: 5, structures: 1 + 2 },
};

const baseConfig = mapId => ({
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  world: { jungle: false, minions: false },
  ...(mapId === undefined ? {} : { mapId }),
});

const harness = await startHarness();
const { url, page, report, check } = harness;

/** Seeds `localStorage` before the first navigation, then loads the menu fresh. */
const seedAndLoad = async config => {
  await page.addInitScript(
    ([key, cfg]) => window.localStorage.setItem(key, JSON.stringify(cfg)),
    [CFG_KEY, config]
  );
  await page.goto(url, { waitUntil: 'load' });
};

/** The stored config's own `mapId`, however this run got there. */
const storedMapId = () =>
  page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.mapId ?? null, CFG_KEY);

/** Enters a match from the menu with no config interaction — `Chơi`. */
const playDirectly = async () => {
  await page.waitForSelector('#play-btn', { timeout: 30_000 });
  await page.click('#play-btn');
};

/**
 * Every fact this script asserts on, read off the live `Game` — never a
 * screenshot. `game.terrainMap.obstacles` is `TerrainMap`'s own flattened
 * wall+bush+water list (`Obstacle[]`, one per polygon across all three
 * layers), and `game.turrets` is one entry per `slots.structure` row
 * (`Game.spawnTurrets`) — both populated synchronously in `Game`'s
 * constructor, before the first tick, so no extra wait is needed once the
 * object exists at all.
 */
const worldFacts = () =>
  page.evaluate(() => {
    const game = window.__lol2d?.scene?.oScene?.game;
    if (!game) return null;
    return {
      mapId: game.activeMapId,
      mapSize: game.mapSize,
      terrainPolygons: game.terrainMap.obstacles.length,
      structures: game.turrets.length,
    };
  });

const waitForMatch = () =>
  page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });

const checkWorldMatches = (label, expectedId) => async () => {
  await waitForMatch();
  await page.waitForTimeout(300);
  const facts = await worldFacts();
  report[label] = facts;
  const want = EXPECTED[expectedId];
  check(`${label}: mapId is ${expectedId}`, facts?.mapId === expectedId, JSON.stringify(facts));
  check(
    `${label}: world size matches ${expectedId}`,
    facts?.mapSize === want.mapSize,
    `${facts?.mapSize} !== ${want.mapSize}`
  );
  check(
    `${label}: terrain polygon count matches ${expectedId}`,
    facts?.terrainPolygons === want.terrainPolygons,
    `${facts?.terrainPolygons} !== ${want.terrainPolygons}`
  );
  check(
    `${label}: structure count matches ${expectedId}`,
    facts?.structures === want.structures,
    `${facts?.structures} !== ${want.structures}`
  );
};

await harness.guard(async () => {
  // ------------------------------------------------------- 1. the default
  await seedAndLoad(baseConfig(undefined));
  await playDirectly();
  await checkWorldMatches('default config (no mapId)', SUMMONERS_RIFT_ID)();

  // ------------------------------------------------------ 2. a stale pick
  await seedAndLoad(baseConfig('nope:this-pack-does-not-exist'));
  await playDirectly();
  await checkWorldMatches('stale/uninstalled mapId falls back', SUMMONERS_RIFT_ID)();

  // ------------------------------------------- 3. the picker lists both
  await seedAndLoad(baseConfig(undefined));
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible' });
  await page.click('#practice-tab-rules');
  await page.waitForSelector('#practice-map', { timeout: 30_000 });

  const optionNames = await page.$$eval('#practice-map option', nodes =>
    nodes.map(n => n.textContent.trim())
  );
  report.mapPickerOptions = optionNames;
  check(
    "the Trận đấu tab's map picker lists both installed maps",
    optionNames.includes("Summoner's Rift") && optionNames.includes('Sân Thử Nghiệm'),
    optionNames.join(' / ')
  );

  // --------------------------------------------- 4. pick, and the qualified id
  await page.selectOption('#practice-map', PROVING_GROUNDS_ID);
  const stored = await storedMapId();
  report.storedMapIdAfterPick = stored;
  check(
    'picking Sân Thử Nghiệm persists its qualified id, not the bare local id',
    stored === PROVING_GROUNDS_ID,
    `stored mapId = ${JSON.stringify(stored)}`
  );

  await page.click('#pregame-start-btn');

  // ---------------------------------------------- 5. the world it started
  await checkWorldMatches('picked Proving Grounds', PROVING_GROUNDS_ID)();

  // ------------------------------------------------------ 6. no page errors
  check('no page errors', harness.errors.length === 0, harness.errors[0]);
});
