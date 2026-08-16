import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Jinx_R, {
  Jinx_R_Object,
  Jinx_R_Smoke,
  SMOKE_MS,
  SMOKE_STEP,
} from '../../../src/game/gameObject/spells/Jinx_R';
import AoePulse from '../../../src/game/gameObject/spellObjects/AoePulse';
import type { Rectangle } from '../../../src/libs/quadtree';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const fire = () => {
  const game = createGame();
  const jinx = createUnit(game, 0, 'blue');
  (game as unknown as { worldMouse: unknown }).worldMouse = createVector(1_000, 0);
  game.objectManager.queryObjects = vi.fn(() => []) as never;

  new Jinx_R(jinx).onSpellCast();
  let rocket: Jinx_R_Object | undefined;
  let smoke: Jinx_R_Smoke | undefined;
  for (const object of game.objectManager._objectToBeAdd) {
    if (object instanceof Jinx_R_Object) rocket = object;
    if (object instanceof Jinx_R_Smoke) smoke = object;
  }
  return { game, jinx, rocket: rocket!, smoke: smoke! };
};

/** Top-left rectangles, the same convention every other display box uses. */
const covers = (box: Rectangle, x: number, y: number): boolean =>
  x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

describe('Jinx R drags a plume that is its own object', () => {
  it('launches the smoke alongside the rocket, wired both ways', () => {
    const { rocket, smoke } = fire();

    expect(rocket).toBeInstanceOf(Jinx_R_Object);
    expect(smoke).toBeInstanceOf(Jinx_R_Smoke);
    expect(smoke.source).toBe(rocket);
    expect(rocket.smoke).toBe(smoke);
    expect(smoke.puffs).toHaveLength(0);
  });

  it('lays puffs along the flight path, spaced rather than one per frame', () => {
    const { rocket, smoke } = fire();

    for (let i = 0; i < 40; i++) {
      rocket.update();
      smoke.update();
    }

    expect(smoke.puffs.length).toBeGreaterThan(2);
    // Forty frames at 16+ units each is well over forty puffs if it painted
    // every frame; the step is what keeps a cross-map shot affordable.
    expect(smoke.puffs.length).toBeLessThan(20);
    expect(smoke.puffs[smoke.puffs.length - 1].x).toBeGreaterThan(smoke.puffs[0].x);
    for (let i = 1; i < smoke.puffs.length; i++) {
      const gap = Math.hypot(
        smoke.puffs[i].x - smoke.puffs[i - 1].x,
        smoke.puffs[i].y - smoke.puffs[i - 1].y
      );
      expect(gap).toBeGreaterThanOrEqual(SMOKE_STEP);
    }
  });

  /**
   * The reason the plume is not painted from `Jinx_R_Object.draw()`.
   *
   * `ObjectManager.draw` culls by the drawing object's own bounds, so anything
   * a rocket paints disappears the moment the rocket leaves the camera — and
   * this rocket is *global*, so it spends almost all of its life off screen
   * while its smoke hangs over a lane somebody is looking at. Lux R shipped
   * with exactly this bug. The test is the difference between the two boxes:
   * the smoke's covers the oldest puff, the rocket's does not come close.
   */
  it('keeps bounds over the whole plume, not over the rocket', () => {
    const { rocket, smoke } = fire();
    for (let i = 0; i < 60; i++) {
      rocket.update();
      smoke.update();
    }
    const oldest = smoke.puffs[0];

    expect(covers(smoke.getDisplayBoundingBox(), oldest.x, oldest.y)).toBe(true);
    expect(
      covers(rocket.getDisplayBoundingBox(), oldest.x, oldest.y),
      'the rocket is long gone from where its smoke still hangs'
    ).toBe(false);
  });

  it('outlives the rocket, then dissipates puff by puff', () => {
    const { rocket, smoke } = fire();
    for (let i = 0; i < 40; i++) {
      rocket.update();
      smoke.update();
    }

    rocket.toRemove = true;
    smoke.update();
    expect(smoke.source, 'the painter is gone').toBeNull();
    expect(smoke.puffs.length, 'the smoke is not').toBeGreaterThan(0);
    expect(smoke.toRemove).toBe(false);

    vi.stubGlobal('deltaTime', SMOKE_MS * 2);
    smoke.update();
    vi.stubGlobal('deltaTime', 16);

    expect(smoke.puffs).toHaveLength(0);
    expect(smoke.toRemove).toBe(true);
  });

  it('balls the plume up where it detonates, under two separate pulses', () => {
    const { game, rocket, smoke } = fire();
    for (let i = 0; i < 40; i++) {
      rocket.update();
      smoke.update();
    }
    const before = smoke.puffs.length;

    rocket.detonate();

    expect(smoke.puffs.length).toBeGreaterThan(before);
    const pulses = game.objectManager._objectToBeAdd.filter(
      (object: unknown) => object instanceof AoePulse
    );
    // A fireball and the crater it leaves: one ring is what every other area
    // ability in the game looks like, and this one has to look bigger.
    expect(pulses).toHaveLength(2);
    expect(new Set(pulses.map((pulse: AoePulse) => pulse.style)).size).toBe(2);
  });
});
