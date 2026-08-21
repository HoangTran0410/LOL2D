import { setActiveLanes } from '../../src/game/lanes';
import { summonersRiftGeometry } from '../../packs/riot/maps/summonersRiftGeometry';

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
 */
export function installSummonersRiftLanesForTests(): void {
  setActiveLanes(summonersRiftGeometry.lanes);
}
