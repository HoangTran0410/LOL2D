import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Thresh_E, {
  HALF_LENGTH,
  HALF_WIDTH,
  SWEEP_DISTANCE,
  Thresh_E_Object,
} from '../../../src/game/gameObject/spells/Thresh_E';
import Thresh_W, {
  RADIUS,
  Thresh_W_Lantern_Throw,
  Thresh_W_Object,
} from '../../../src/game/gameObject/spells/Thresh_W';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const at = (x: number, y: number, team: string, game: ReturnType<typeof createGame>) => {
  const unit = createUnit(game, 0, team);
  unit.position.set(x, y);
  unit.stats.maxHealth.baseValue = 200;
  unit.stats.health.baseValue = 200;
  return unit;
};

const aimAt = (game: ReturnType<typeof createGame>, x: number, y: number) => {
  (game as unknown as { worldMouse: unknown }).worldMouse = createVector(x, y);
};

/**
 * Flay is a *sweep*: a rectangle centred on Thresh, turned to face the cursor,
 * and everyone it catches goes the same way. It used to be a circle around him
 * that shoved each victim from wherever they happened to stand.
 */
describe('Thresh E sweeps a box, in one direction', () => {
  const cast = () => {
    const game = createGame();
    const thresh = at(0, 0, 'blue', game);
    aimAt(game, 1000, 0); // due east
    return { game, thresh, spell: new Thresh_E(thresh) };
  };

  it('catches what is in the box and misses what is beside it', () => {
    const { game, spell } = cast();
    const inFront = at(HALF_LENGTH - 20, 0, 'red', game);
    const behind = at(-(HALF_LENGTH - 20), 0, 'red', game); // the box is centred on him
    const beside = at(0, HALF_WIDTH + 120, 'red', game); // square to the swing
    const far = at(HALF_LENGTH + 200, 0, 'red', game);
    game.objectManager.queryObjects = vi.fn(() => [inFront, behind, beside, far]) as never;

    const caught = spell.enemiesInBox(0);

    expect(caught).toContain(inFront);
    expect(caught, 'the box reaches behind him too').toContain(behind);
    expect(caught, 'a circle would have caught this one').not.toContain(beside);
    expect(caught).not.toContain(far);
  });

  it('sends everyone it catches the same way, along player → cursor', () => {
    const { game, spell } = cast();
    // Two victims on opposite sides of Thresh: a radial push would send them
    // apart, which is what this looked like.
    const north = at(30, -60, 'red', game);
    const south = at(30, 60, 'red', game);
    game.objectManager.queryObjects = vi.fn(() => [north, south]) as never;

    spell.onSpellCast();

    for (const victim of [north, south]) {
      const dash = victim.buffs.find(buff => buff instanceof Dash) as Dash | undefined;
      expect(dash, 'swept, not shoved').toBeTruthy();
      // Due east of where they stood, by exactly the sweep distance.
      expect(dash!.dashDestination!.x - victim.position.x).toBeCloseTo(SWEEP_DISTANCE, 3);
      expect(dash!.dashDestination!.y - victim.position.y).toBeCloseTo(0, 3);
    }
  });

  it('turns the box with the cursor', () => {
    const { game, thresh } = cast();
    aimAt(game, 0, 1000); // due south
    const spell = new Thresh_E(thresh);
    const south = at(0, HALF_LENGTH - 20, 'red', game);
    const east = at(HALF_LENGTH - 20, 0, 'red', game);
    game.objectManager.queryObjects = vi.fn(() => [south, east]) as never;

    spell.onSpellCast();

    const swing = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Thresh_E_Object => object instanceof Thresh_E_Object
    );
    expect(swing!.heading).toBeCloseTo(Math.PI / 2, 3);
    expect(south.buffs.some(buff => buff instanceof Dash)).toBe(true);
    expect(east.buffs.some(buff => buff instanceof Dash), 'now out of the box').toBe(false);
  });
});

/**
 * The lantern is thrown and *then* hangs. Spawning it at the destination gave
 * the ability no travel and no tell.
 */
describe('Thresh W is thrown before it is a lantern', () => {
  const throwIt = () => {
    const game = createGame();
    const thresh = at(0, 0, 'blue', game);
    aimAt(game, 300, 0);
    game.objectManager.queryObjects = vi.fn(() => []) as never;
    new Thresh_W(thresh).onSpellCast();
    const flight = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Thresh_W_Lantern_Throw =>
        object instanceof Thresh_W_Lantern_Throw
    );
    return { game, thresh, flight: flight! };
  };

  it('puts a missile in the air, not a lantern on the ground', () => {
    const { thresh, flight } = throwIt();

    expect(flight, 'the throw is an object of its own').toBeTruthy();
    expect(flight.position.dist(thresh.position)).toBeCloseTo(0, 3);
    expect(flight.maxHitCount, 'lobbed over the fight, not into it').toBe(0);
  });

  it('becomes the lantern only on arrival', () => {
    const { game, flight } = throwIt();

    const lanternBefore = game.objectManager._objectToBeAdd.filter(
      (object: unknown) => object instanceof Thresh_W_Object
    );
    expect(lanternBefore).toHaveLength(0);

    for (let i = 0; i < 200 && !flight.toRemove; i++) flight.update();

    const lantern = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Thresh_W_Object => object instanceof Thresh_W_Object
    );
    expect(lantern).toBeTruthy();
    expect(lantern!.position.x).toBeCloseTo(300, 0);
  });

  it('shields allies standing in the light and nobody outside it', () => {
    const { game, thresh, flight } = throwIt();
    while (!flight.toRemove) flight.update();
    const lantern = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Thresh_W_Object => object instanceof Thresh_W_Object
    )!;

    const inside = at(300 + RADIUS - 30, 0, thresh.teamId, game);
    // Outside the circle, but well inside the square the quadtree searches —
    // this is exactly the unit that used to get shielded.
    const outside = at(300 + RADIUS + 120, 0, thresh.teamId, game);
    game.objectManager.queryObjects = vi.fn(() => [inside, outside]) as never;

    vi.stubGlobal('deltaTime', 600);
    lantern.update();
    vi.stubGlobal('deltaTime', 16);

    expect(inside.buffs.some(buff => buff instanceof Shield)).toBe(true);
    expect(outside.buffs.some(buff => buff instanceof Shield)).toBe(false);
  });
});
