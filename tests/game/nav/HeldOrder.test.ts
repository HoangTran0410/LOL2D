import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import NavigationSystem from '../../../src/game/nav/NavigationSystem';
import { NAV_GOAL_TOLERANCE } from '../../../src/game/nav/PathAgent';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

const MAP = 2_560;

/**
 * Holding right click has to keep working.
 *
 * `Game.update` re-issues `orderMove(worldMouse)` on every frame the right
 * button is down, and the camera rides the champion — so the *world* point
 * under a stationary cursor walks forward at exactly the champion's own speed.
 *
 * `PathAgent.order` used to measure "has this order changed?" against last
 * frame's goal. A goal creeping forward three pixels a frame never trips a
 * 120px tolerance, and `remaining` sits pinned at whatever the cursor's screen
 * offset is, so the "you are nearly there, take the order" escape never fires
 * either. The order was swallowed every frame for the rest of the match, and
 * `destination` — which only `plan()` ever writes — kept pointing at wherever
 * the cursor had been when the button went down. The champion walked there,
 * arrived, and stood still with the button still held.
 *
 * It read as a buff bug because that is when it is visible: a haste or a slow
 * changes how fast the champion covers the stale destination, so the freeze
 * lands right around the moment the buff starts or ends.
 *
 * The rule is stated as travel, not as internals: a held order must keep the
 * champion moving for as long as it is held.
 */
describe('a held move order keeps the champion moving', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame(MAP);
    game.navigation = new NavigationSystem([], MAP);
  });

  afterEach(() => vi.unstubAllGlobals());

  /**
   * One frame of the real loop: re-issue the order at the cursor, let the agent
   * advance, then step the champion at its destination. The cursor is carried
   * forward by exactly the distance the champion covered, which is what the
   * camera does to a stationary mouse.
   */
  const holdFor = (frames: number, cursorOffset: number) => {
    const unit = new AttackableUnit({ game, position: createVector(300, 300) });
    const cursor = { x: 300 + cursorOffset, y: 300 };
    let travelled = 0;

    for (let i = 0; i < frames; i++) {
      const from = { x: unit.position.x, y: unit.position.y };
      unit.navigateTo(cursor.x, cursor.y, true);
      unit.pathAgent?.update(16);
      unit.move();
      const step = Math.hypot(unit.position.x - from.x, unit.position.y - from.y);
      travelled += step;
      cursor.x += unit.position.x - from.x;
      cursor.y += unit.position.y - from.y;
    }
    return { unit, travelled, cursor };
  };

  it('is still walking long after it has passed the point it was first ordered to', () => {
    // Far enough out that the old "nearly there" escape could never fire: the
    // swallow only released within `NAV_GOAL_TOLERANCE * 2` of the goal, and a
    // held cursor stays at a fixed offset forever.
    const offset = NAV_GOAL_TOLERANCE * 3;
    const { unit, travelled } = holdFor(400, offset);

    // 400 frames at the default move speed is well past the original goal, so a
    // champion that stopped on reaching it covers about `offset` and no more.
    expect(travelled).toBeGreaterThan(offset * 2);
    expect(unit.pathAgent!.isActive).toBe(true);
  });

  it('keeps its speed through the last stretch, not just the first', () => {
    const offset = NAV_GOAL_TOLERANCE * 3;
    const early = holdFor(60, offset).travelled;
    const late = holdFor(400, offset).travelled - holdFor(340, offset).travelled;

    // The last 60 frames have to cover what the first 60 did. Under the bug the
    // early window was full speed and the late one was zero.
    expect(late).toBeGreaterThan(early * 0.8);
  });

  it('still swallows a repeat of an order that has not actually moved', () => {
    // The whole reason the check exists: chase code re-issues at a target that
    // is jinking on the spot, and each of those must not buy a fresh plan.
    const unit = new AttackableUnit({ game, position: createVector(300, 300) });
    unit.navigateTo(1_200, 300, true);
    const planned = { x: unit.destination.x, y: unit.destination.y };

    const spy = vi.spyOn(game.navigation as NavigationSystem, 'isLineClear');
    for (let i = 0; i < 30; i++) unit.navigateTo(1_200 + (i % 2), 300, true);

    expect(spy).not.toHaveBeenCalled();
    expect(unit.destination.x).toBeCloseTo(planned.x, 5);
  });
});
