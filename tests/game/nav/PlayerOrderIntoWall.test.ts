import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import NavigationSystem from '../../../src/game/nav/NavigationSystem';
import { NAV_MAX_ACCEPTED_OVERLAP } from '../../../src/game/nav/NavGrid';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * How far a body may end up inside a wall while walking a route the grid
 * approved, with `pushOutOfWalls` switched off.
 *
 * Not zero, and deliberately the project's own measured bound rather than a
 * number chosen here: `NavGrid.requiredClearance` adds half a *cell* of margin
 * while a body standing at a cell corner is half a *diagonal* from its centre,
 * and the difference is exactly `NAV_MAX_ACCEPTED_OVERLAP`. That trade is
 * documented on that method and swept over the shipped map by
 * `NavGrid.test.ts`, which measures 2.84px against the 4px bound.
 *
 * This file read zero for a while, which was luck rather than a guarantee: the
 * clearance field used to be derived from rasterized cell centres and so
 * *understated* the true distance to a wall, padding every route by up to 19px
 * of accidental margin. `NavGrid.refineNearWalls` removed that padding — it was
 * closing jungle passages a champion visibly fits through — and with it this
 * file's free ride. Asserting zero here now would be asserting something
 * stricter than the navigation grid has ever promised.
 *
 * The other half of each test is untouched and is the stronger claim anyway:
 * routing must never *aim* a destination inside a wall, and that stays at zero.
 */
const ACCEPTED_GRAZE = -NAV_MAX_ACCEPTED_OVERLAP;

/**
 * Reproduces `Game.fixedUpdate`'s exact per-frame order for the local player:
 *
 *   navigation.update()    // drains queued searches, incl. last frame's order
 *   objectManager.update() // -> champion.update() -> pathAgent.update(); move()
 *   terrainMap.update()    // push-out (SKIPPED here on purpose -- see below)
 *   if (rightMouseHeld) champion.orderMove(mouseX, mouseY, true)
 *
 * `pushOutOfWalls` is deliberately left out: it is the safety net that
 * corrects a body already overlapping a wall, and this file exists to answer
 * a narrower question -- does the *routing itself* ever aim a unit's
 * destination at, or walk its position into, real wall geometry, independent
 * of whether physics would later paper over it. Skipping the net makes any
 * algorithmic mistake visible instead of silently patched.
 *
 * This is what settled "clicking a wall sometimes walks straight into it"
 * (the LOL2D owner's bug report, and a bug-report hypothesis this file
 * disproved and replaced). The originally suspected mechanism -- `plan()`
 * holding `destination` at the raw click for "the frame or two the search
 * takes" -- turns out not to be observable: `NavigationSystem.update()` runs
 * before `ObjectManager.update()` in `Game.fixedUpdate`, and the click
 * handler runs after both, so a queued search always resolves one frame
 * before `move()` ever reads the destination it set. The single-click test
 * below proves that directly.
 *
 * The real mechanism is in `PathAgent.update()`'s arrival handling. `order()`
 * lets `goalX`/`goalY` track a held, dragged order every frame without a full
 * replan as long as the drift is under `NAV_GOAL_TOLERANCE` (120px) -- a
 * chasing bot calls `navigateTo` sixty times a second and needs exactly that
 * collapse. But when a short (sometimes single-waypoint) route finishes near
 * such a drifted goal, the old code trusted "remaining <= NAV_GOAL_TOLERANCE"
 * as license to snap `destination` straight at `goalX`/`goalY` with no
 * clearance check at all -- unlike a fresh order, which only ever *walks
 * towards* an unverified point at `moveSpeed` per frame. Held near a wall,
 * that combination let a drag walk the goal a few pixels past the moat every
 * frame while the unit was standing still, and the eventual "arrival" snap
 * committed to whatever the goal had drifted to, wall or not. The held-drag
 * test below reproduces exactly that and would have failed before the fix in
 * `PathAgent.update()`.
 */

const WALL_MIN_X = 900;
const WALL_MAX_X = 940;
const WALL_MIN_Y = 0;
const WALL_MAX_Y = 2_000;
const WALL = [
  { x: WALL_MIN_X, y: WALL_MIN_Y },
  { x: WALL_MAX_X, y: WALL_MIN_Y },
  { x: WALL_MAX_X, y: WALL_MAX_Y },
  { x: WALL_MIN_X, y: WALL_MAX_Y },
];
const MAP = 2_560;
const RADIUS = 27.5;

/**
 * Signed distance from (x,y) to WALL's surface -- negative means inside it.
 * A real point-to-rectangle distance, not just an X-band check: the wall
 * ends at y=2000, and a route legitimately passes close to its X range while
 * safely south of it, which an X-only check would misreport as clipping.
 */
const wallClearance = (x: number, y: number): number => {
  const inside = x > WALL_MIN_X && x < WALL_MAX_X && y > WALL_MIN_Y && y < WALL_MAX_Y;
  if (inside) {
    return -Math.min(x - WALL_MIN_X, WALL_MAX_X - x, y - WALL_MIN_Y, WALL_MAX_Y - y);
  }
  const dx = x < WALL_MIN_X ? WALL_MIN_X - x : x > WALL_MAX_X ? x - WALL_MAX_X : 0;
  const dy = y < WALL_MIN_Y ? WALL_MIN_Y - y : y > WALL_MAX_Y ? y - WALL_MAX_Y : 0;
  return Math.hypot(dx, dy);
};

let game: TestGame;

const withNavigation = (): NavigationSystem => {
  const navigation = new NavigationSystem([WALL], MAP);
  game.navigation = navigation;
  return navigation;
};

describe('player click/drag into a wall (Game.fixedUpdate order, no push-out)', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame(MAP);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never sets destination, or walks position, into real wall geometry on a single click through the wall', () => {
    const navigation = withNavigation();
    const champion = new Champion({ game, position: createVector(400, 1_000) });
    champion.stats.speed.baseValue = 8;
    game.setPlayer(champion);
    indexObjects(game, [champion]);

    let worstDestination = Infinity;
    let worstPosition = Infinity;

    champion.orderMove(1_400, 1_000, true); // the click lands past the wall

    for (let frame = 0; frame < 120; frame++) {
      navigation.update(); // resolves last frame's queued/urgent search
      champion.update(); // pathAgent.update() then move()

      worstDestination = Math.min(
        worstDestination,
        wallClearance(champion.destination.x, champion.destination.y) - RADIUS
      );
      worstPosition = Math.min(
        worstPosition,
        wallClearance(champion.position.x, champion.position.y) - RADIUS
      );

      // the click handler runs at the very end of fixedUpdate, same as Game.ts
      champion.orderMove(1_400, 1_000, true);
    }

    expect(
      worstDestination,
      'destination was aimed inside real wall geometry'
    ).toBeGreaterThanOrEqual(0);
    expect(worstPosition, 'position walked into real wall geometry').toBeGreaterThanOrEqual(
      ACCEPTED_GRAZE
    );
  });

  it('never sets destination, or walks position, into the wall during a held drag across it', () => {
    const navigation = withNavigation();
    const champion = new Champion({ game, position: createVector(400, 1_000) });
    champion.stats.speed.baseValue = 8;
    game.setPlayer(champion);
    indexObjects(game, [champion]);

    let worstDestination = Infinity;
    let worstPosition = Infinity;

    // A drag: mouse starts left of the wall, at 400, and creeps right by 6px
    // a frame -- comfortably under NAV_GOAL_TOLERANCE (120) so most frames
    // hit the "same order" collapse path in PathAgent.order() rather than a
    // full re-plan, which is exactly the combination that exposed the bug.
    let mouseX = 400;
    champion.orderMove(mouseX, 1_000, true);

    for (let frame = 0; frame < 300; frame++) {
      navigation.update();
      champion.update();

      worstDestination = Math.min(
        worstDestination,
        wallClearance(champion.destination.x, champion.destination.y) - RADIUS
      );
      worstPosition = Math.min(
        worstPosition,
        wallClearance(champion.position.x, champion.position.y) - RADIUS
      );

      mouseX = Math.min(1_400, mouseX + 6);
      champion.orderMove(mouseX, 1_000, true);
    }

    expect(
      worstDestination,
      'destination was aimed inside real wall geometry'
    ).toBeGreaterThanOrEqual(0);
    expect(worstPosition, 'position walked into real wall geometry').toBeGreaterThanOrEqual(
      ACCEPTED_GRAZE
    );
  });
});
