import { vi } from 'vitest';
import { fastHypot } from '../src/utils/optimized.utils';
import AssetManager from '../src/managers/AssetManager';
import { assetManifest as riotAssetManifest } from '../packs/riot/generated/assetManifest';
import { installSummonersRiftLanesForTests } from './game/lanesFixture';

Math.hypot = fastHypot;

/**
 * Batch 4 task 4 moved 377 champion portraits, spell icons and monster art
 * files out of core's `assets/` into `packs/riot/assets/`, so `spell_flash`,
 * `champ_yasuo` and the rest are no longer keys `AssetManager`'s own
 * manifest knows — only a *registered* pack manifest does
 * (`registerPackAssets`, resolved by `AssetManager.resolveDescriptor`'s
 * install-order fallback). In the real app that registration is a side
 * effect of importing `src/content/install.ts`; a great many spell
 * tests construct a real spell class straight from `buildContentApi()` and
 * a pack factory (`makeFlash(buildContentApi())`, `stacks.test.ts` and
 * others) without ever touching `install.ts` or `contentRegistry()`, so
 * without this every one of those constructors threw "Unknown asset key"
 * the moment its `image = api.asset('spell_x')` field initializer ran.
 * One registration here, in the file every test file's environment already
 * runs before its own top-level code, covers every one of them — the same
 * shape `install.ts`'s own registration takes, just run once for the
 * whole suite instead of once per pack install.
 *
 * `?.` because dozens of test files `vi.mock('.../AssetManager', ...)` with
 * a bare `{ get, getAsset }` double that has no `registerPackAssets` at
 * all — hoisted mocks apply to this setup file's own import too, and a
 * no-op under one is correct: those doubles never resolve a real key.
 */
AssetManager.registerPackAssets?.('riot', riotAssetManifest);

/**
 * Batch 4 task 6 moved Summoner's Rift's own lane waypoints out of
 * `src/game/lanes.ts` and into `packs/riot/maps/summonersRiftGeometry.ts` —
 * core's own default is an empty, laneless map now (Spec §7), because core
 * ships no map's coordinates (`tests/content/summonersRiftCoordinateBoundary.test.ts`
 * is the scan that holds it to that). Before that move, `lanes.ts`'s own
 * out-of-the-box default *was* Summoner's Rift's three lanes, so every test
 * that reads `LANES`/`LANE_WAYPOINTS`/`getLaneWaypoints` without
 * constructing a real `Game` (nothing in this suite does — see
 * `fixtures.ts`'s `createGame`, always the lightweight test double) got a
 * concrete lane for free, including at *module* scope — `MinionSpawner.test.ts`'s
 * `WAVE_SIZE = 2 * LANES.length * ...` is computed once, at import time,
 * which no per-test `beforeEach` could ever reach in time to fix. Installing
 * the same real, checked-in map here — once, in the file every test file's
 * environment already runs before its own top-level code — covers every one
 * of those the same way the asset registration above covers `api.asset()`.
 *
 * A test that specifically wants the true empty default (or its own
 * synthetic lane set) calls `resetLanesForTests()` first, to release the
 * guard this takes — `tests/game/minions/Lanes.test.ts` and
 * `tests/game/ai/TeamBlackboard.lanes.test.ts`/`BotBrain.push.test.ts`'s own
 * "a laneless map" blocks do exactly that, and the latter two restore this
 * same install afterward (`lanesFixture.ts`'s own doc comment explains why a
 * bare `resetLanesForTests()` there is not enough).
 */
installSummonersRiftLanesForTests();

Object.assign(globalThis, {
  deltaTime: 16,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  constrain: (n: number, low: number, high: number) => Math.min(high, Math.max(low, n)),
  random: (min = 1, max?: number) =>
    max === undefined ? Math.random() * min : min + Math.random() * (max - min),
  floor: Math.floor,
  createVector: vi.fn(),
});
