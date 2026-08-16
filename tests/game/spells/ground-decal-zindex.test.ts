import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import { Nocturne_Q_Trail } from '../../../src/game/gameObject/spells/Nocturne_Q';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import { Singed_W_Object } from '../../../src/game/gameObject/spells/Singed_W';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
} from '../spell/fixtures';

/**
 * A stain on the floor draws under the feet standing on it.
 *
 * `ObjectManager`'s `Z_INDEX_MAP` is keyed by *exact constructor*, so a
 * `SpellObject` subclass does not inherit SpellObject's slot of 2 — it falls
 * through to `DEFAULT_Z_INDEX`, which is 99, above `Champion.displayZIndex` of
 * 4. That is the right default for a missile or a blast, and exactly wrong for
 * ground art: Nocturne's Dusk Trail was painting over the feet of everyone
 * walking down it, and nothing in the type system says so.
 *
 * The number is not the property — being under a unit is. Comparing against the
 * unit z-indices means retuning either side cannot quietly invert the two.
 */
describe('ground decals paint under the units on top of them', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Nocturne's Dusk Trail is below champions and minions", () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const trail = new Nocturne_Q_Trail(owner);

    expect(trail.zIndex).not.toBeNull();
    expect(trail.zIndex!).toBeLessThan(Champion.displayZIndex);
    expect(trail.zIndex!).toBeLessThan(Minion.displayZIndex);
  });

  it('shares the slot the existing ground effects already use', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    // Singed's poison cloud answered this question first. A second, different
    // answer would mean two ground effects layering unpredictably over each
    // other depending on which spell happened to be cast last.
    const cloud = new Singed_W_Object(owner);
    const trail = new Nocturne_Q_Trail(owner);
    expect(trail.zIndex).toBe(cloud.zIndex);
  });
});
