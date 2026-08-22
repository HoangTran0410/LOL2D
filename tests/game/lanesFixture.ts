import { setActiveLanes } from '../../src/game/lanes';
import { installedPacks } from '../../src/generated/installedPacks';
import type { LaneDefinition } from '../../src/content/ContentPack';

/**
 * The first installed pack's first map's lanes, cached once for the whole
 * suite. `loadPackLanesForTests()` fills it, from `tests/setup.ts`; everything
 * else reads it synchronously.
 *
 * Content-pack-extraction batch 5 task 8 is why this is derived rather than
 * imported. It used to be a plain
 * `import { summonersRiftGeometry } from '../../packs/riot/maps/summonersRiftGeometry'`
 * — and that import was reached from `tests/setup.ts`, i.e. Vitest's *global
 * setup*, so with `packs/riot/` moved out of the tree the failure was not
 * "the pack's lane tests fail", it was the whole suite failing to start on an
 * unresolved specifier. Reading `installedPacks[0]` instead means a checkout
 * with no optional pack simply has no lanes to install, which is the honest
 * answer: core ships no map's coordinates (Spec §7), and the reference pack's
 * own map has none either.
 */
let packLanes: LaneDefinition[] = [];

/**
 * Resolves the first installed pack's first map's geometry. Async because
 * `MapDefinition.geometry` is a lazy loader — the terrain and lanes sit behind
 * a dynamic import so the menu's chunk never carries them — and `tests/setup.ts`
 * is allowed a top-level `await`.
 *
 * Everything under `packs/` is reached through the generated barrel here, not
 * by path, for the same reason `src/content/install.ts` does it: a relative
 * path into `packs/` resolves to nothing the day the pack is a repository of
 * its own, and a *static* one cannot be made conditional at all.
 */
export async function loadPackLanesForTests(): Promise<void> {
  const map = installedPacks[0]?.data.maps?.[0];
  if (!map) return;
  const geometry = await map.geometry();
  packLanes = geometry.lanes ?? [];
}

/**
 * Installs Summoner's Rift's real lane waypoints as the active match's lane
 * set — the same real, checked-in map `tests/setup.ts` installs for every
 * test file's environment by default (see that file's own doc comment for
 * why: core's own default is empty now, and a great many tests here read
 * `LANES`/`LANE_WAYPOINTS`/`getLaneWaypoints` without ever constructing a
 * real `Game`).
 *
 * A describe block that installs its *own* lane set for one or two tests
 * (a laneless map, a synthetic one) and then wants later describes in the
 * same file to keep seeing the ordinary ambient default calls this in its
 * own `afterEach`, right after `resetLanesForTests()` — `resetLanesForTests()`
 * alone only releases the guard and leaves `LANES`/`LANE_WAYPOINTS` empty,
 * which is correct for *that* describe's own teardown but leaks an empty
 * lane set into every test that runs after it in the same file (Vitest does
 * not re-run `setupFiles` between describes, only between files).
 * `tests/game/ai/TeamBlackboard.lanes.test.ts` and `BotBrain.push.test.ts`'s
 * own "a laneless map" blocks are the two places this bit in practice — the
 * describes after them read real minion positions through `getLaneWaypoints`
 * and quietly saw an empty array instead, which does not fail loudly, it
 * just changes what a bot decides to do.
 *
 * Stays synchronous, and stays named after the map it installs in practice:
 * both call sites above use it in an `afterEach`, and every caller today is a
 * test that only runs when the pack providing that map is installed.
 */
export function installSummonersRiftLanesForTests(): void {
  setActiveLanes(packLanes);
}
