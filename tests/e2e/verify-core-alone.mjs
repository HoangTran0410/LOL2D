/**
 * Does the game still **boot** with no optional content pack installed?
 *
 * This is the half of content-pack-extraction batch 5 task 8 that is easy to
 * skip and is the actual point. A build that succeeds and a menu that
 * dead-ends is the failure this whole step exists to catch: `npm run verify`
 * passing without `packs/riot/` proves core *compiles* alone, and proves
 * nothing at all about whether a player who launches it can reach a match.
 * Every guard upstream of this one runs in Vitest on `environment: 'node'` —
 * no renderer, no p5, no DOM, no `GameScene`.
 *
 * Run it inside the departure drill's own window, i.e. with `packs/riot/`
 * moved out of the tree, `npm install` run and the barrel regenerated:
 *
 *   npm run verify:without-packs   # does the move, the install, the verify
 *   node tests/e2e/verify-core-alone.mjs
 *
 * It is deliberately runnable in *both* conditions, and asserts different
 * things in each — with the riot pack present the default map is Summoner's
 * Rift, without it the reference pack's Proving Grounds. A script that only
 * ran in the stripped state would be a script nobody ever ran by accident,
 * and so a script that had quietly stopped working.
 *
 * ## What "playable" means here, and why each check is in the list
 *
 *   1. **the menu draws** — `#play-btn` exists. With no pack the roster the
 *      menu reads is one champion; a menu that threw while rendering it would
 *      never get here.
 *   2. **a match starts at all** — `window.__lol2d.scene.oScene.game` gains an
 *      `objectManager`. `GameScene.startGame()` awaits the map's geometry and
 *      every kit's chunk before this exists, so reaching it means the whole
 *      content path resolved: catalogue, roster, spell classes, art.
 *   3. **on a map some installed pack provides** — `game.activeMapId`'s pack
 *      prefix. `PregameConfig.DEFAULT_MAP_ID` is the literal
 *      `'riot:summoners-rift'`, so with the riot pack gone this is exercising
 *      `GameScene.startGame()`'s `?? maps[0]` fallback for real rather than
 *      in a unit test's imagination.
 *   4. **the player has a champion with a real kit** — a name, a portrait,
 *      every slot filled (a basic attack, four abilities, two summoners) and a
 *      `recall`. Deliberately not claimed as a test of `install.ts`'s
 *      core-spell fold: `preset.ts` reaches `BasicAttack` and `Recall` through
 *      its own static imports as well, so both would still be there if the
 *      fold were broken. What this does catch is a kit that came back with
 *      holes in it — which is what a roster resolved against a pack that is
 *      not installed looks like.
 *   5. **the world is a world** — terrain, the map's own neutral camps actually
 *      spawned, a fountain belonging to the player's own team, and a queued
 *      wave that actually produces minions.
 *      Straight out of `verify-map-picker.mjs`, whose own header explains why
 *      polygon counts alone certified a map nobody could play on.
 *   6. **the player can act** — one right-click issues a move order the
 *      champion's destination reflects. The cheapest possible proof that the
 *      input path, the nav grid and the match loop are all live, and the one
 *      thing a headless suite structurally cannot see.
 *   7. **no page errors**, the whole time.
 *
 * `ai.count: 0`, so nothing else on the map can raise a page error while the
 * checks read off `game` — the same reason `verify-map-picker.mjs` and
 * `verify-pack-champion.mjs` seed it. **`world` is deliberately left at its
 * default**, unlike those two, and that is the one place this script departs
 * from its models on purpose: `DEFAULT_PREGAME_CONFIG` is "a full jungle and
 * lane minions", so turning the jungle off here would mean the drill only ever
 * booted a configuration no player starts in. It would also have hidden the
 * one real bug this script found — `packs/reference/pack.ts`'s warden camp
 * declaring an `avatar` key nothing in core's manifest held, which throws from
 * `Monster`'s constructor the moment that camp spawns, and which only spawns
 * on the map you get when the riot pack is *not* installed. See
 * `tests/content/packArtKeys.test.ts`, the cheap scan that now closes the
 * class.
 *
 * Check 5 still forces its wave through `MinionSpawner` directly
 * (`queueWave()` then `releaseQueued()`, the seam `drive-game.mjs` uses)
 * rather than waiting out a real 30-second clock.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG_KEY, startHarness } from './harness.mjs';
import { contentPackInstalled } from '../../scripts/installed-packs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const riotInstalled = contentPackInstalled(root, 'riot');

/** The map the fallback is expected to land on, per condition. */
const EXPECTED_MAP = riotInstalled ? 'riot:summoners-rift' : 'reference:proving-grounds';

const harness = await startHarness();
const { url, page, report, check } = harness;

await page.addInitScript(
  ([key, cfg]) => window.localStorage.setItem(key, JSON.stringify(cfg)),
  [
    CFG_KEY,
    {
      ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
    },
  ]
);

/** Everything this script asserts on, read off the live `Game` — no screenshots. */
const matchFacts = () =>
  page.evaluate(() => {
    const game = window.__lol2d?.scene?.oScene?.game;
    if (!game) return null;
    const player = game.player;
    const spawner = game.minionSpawner;
    spawner?.queueWave();
    spawner?.releaseQueued();
    return {
      mapId: game.activeMapId,
      mapSize: game.mapSize,
      terrainPolygons: game.terrainMap?.obstacles?.length ?? 0,
      objects: game.objectManager?.objects?.length ?? 0,
      playerName: player?.presetData?.name ?? player?.name ?? null,
      // `Boolean`, not the object: `avatar` is a `p5.Image`, whose
      // `_pixelsState` closes a cycle that `JSON.stringify` refuses — and
      // `report` is dumped through `JSON.stringify` by the harness's own
      // `finish()`, so returning the image kills the run *after* the checks
      // rather than failing one.
      playerAvatar: Boolean(player?.avatar),
      // Slot 0 is the basic attack; Q/W/E/R follow. A champion whose kit did
      // not resolve has `undefined` holes here, which `filter(Boolean)` counts
      // honestly rather than `spells.length` would.
      spellsInSlots: (player?.spells ?? []).filter(Boolean).length,
      spellNames: (player?.spells ?? []).filter(Boolean).map(spell => spell?.name ?? '?'),
      hasRecall: Boolean(player?.recall),
      playerTeamId: player?.teamId ?? null,
      ownFountain: (game.fountains ?? []).some(f => f.teamId === player?.teamId),
      minionsAfterWave: spawner?.minions?.length ?? 0,
      // The map's own neutral camps, spawned by `Game` from the geometry's
      // `slots.neutral` and filled by whichever installed pack declares a
      // monster for each slot's `role`. Zero here means either no camps or a
      // camp that could not be built.
      monsters: game.monsters?.length ?? 0,
    };
  });

await harness.guard(async () => {
  await page.goto(url, { waitUntil: 'load' });

  // ------------------------------------------------------- 1. the menu draws
  await page.waitForSelector('#play-btn', { timeout: 30_000 });
  check('the menu draws its play button', true);

  // ---------------------------------------------------- 2. a match starts
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 60_000,
  });
  await page.waitForTimeout(500);

  const facts = await matchFacts();
  report.riotPackInstalled = riotInstalled;
  report.match = facts;
  check('a match exists', facts !== null, JSON.stringify(facts));

  // ------------------------------------- 3. on a map an installed pack has
  check(
    `the match runs on ${EXPECTED_MAP}`,
    facts?.mapId === EXPECTED_MAP,
    `activeMapId=${facts?.mapId}`
  );

  // ------------------------------- 4. the player has a champion with a kit
  check('the player has a champion', Boolean(facts?.playerName), JSON.stringify(facts?.playerName));
  check('the player has a portrait', facts?.playerAvatar === true, `avatar=${facts?.playerAvatar}`);
  check(
    'every kit slot resolved to a spell',
    (facts?.spellsInSlots ?? 0) >= 5,
    `${facts?.spellsInSlots} slots: ${JSON.stringify(facts?.spellNames)}`
  );
  check('the champion has a way home', facts?.hasRecall === true, `hasRecall=${facts?.hasRecall}`);

  // ------------------------------------------------- 5. the world is a world
  check('the map has terrain', (facts?.terrainPolygons ?? 0) > 0, `${facts?.terrainPolygons}`);
  check(
    "the map's own neutral camps spawned",
    (facts?.monsters ?? 0) > 0,
    `${facts?.monsters} monsters — a camp whose pack declares art nothing resolves throws here`
  );
  check(
    "the player's own fountain belongs to their team",
    facts?.ownFountain === true,
    JSON.stringify({ team: facts?.playerTeamId, ownFountain: facts?.ownFountain })
  );
  check(
    'a queued wave actually produces minions',
    (facts?.minionsAfterWave ?? 0) > 0,
    `${facts?.minionsAfterWave}`
  );

  // ------------------------------------------------- 6. the player can act
  const box = await page.locator('canvas').first().boundingBox();
  const before = await page.evaluate(() => {
    const player = window.__lol2d?.scene?.oScene?.game?.player;
    return { x: player?.position?.x ?? null, y: player?.position?.y ?? null };
  });
  // Move, then press and release as separate steps with real gaps between
  // them — `drive-basic-attacks.mjs`'s own `rightClick`. p5 reads the cursor
  // off its own `mouseX`/`mouseY`, which only a `mousemove` updates, so a
  // bare `page.mouse.click()` issues an order aimed at wherever the pointer
  // was last (the origin), i.e. at the champion's own feet: measured, this
  // scored `moved 0px` against a perfectly working game.
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65);
  await page.waitForTimeout(120);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const player = window.__lol2d?.scene?.oScene?.game?.player;
    return { x: player?.position?.x ?? null, y: player?.position?.y ?? null };
  });
  const moved = Math.hypot((after.x ?? 0) - (before.x ?? 0), (after.y ?? 0) - (before.y ?? 0));
  report.movement = { before, after, moved: Math.round(moved) };
  check('a right click moves the champion', moved > 5, `moved ${Math.round(moved)}px`);

  // --------------------------------------------------- 7. nothing threw
  check('no runtime errors', harness.errors.length === 0, harness.errors.slice(0, 3).join(' | '));
});
