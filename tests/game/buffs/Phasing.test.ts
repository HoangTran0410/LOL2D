import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Phasing from '../../../src/game/gameObject/buffs/Phasing';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import ActionState from '../../../src/game/enums/ActionState';
import { hasFlag } from '../../../src/utils/index';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';

/**
 * Phasing walks through bodies. Ghosted walks through bodies *and terrain*.
 *
 * They were one flag, which is fine while the only user is `Dash` — a dash is
 * over in a few frames and lands on a point the spell already chose. The moment
 * something with a duration wants to shoulder past a minion wave, that flag
 * also switches off `TerrainMap.pushOutOfWalls`, and a champion who may stand
 * inside a wall for three seconds can walk out of the map.
 *
 * So the property is a *difference*, and testing either flag alone would miss
 * it entirely: both clear unit collision, and exactly one clears terrain.
 */
describe('phasing clears bodies without clearing terrain', () => {
  let game: TestGame;
  let unit: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    unit = createUnit(game, 0, 'blue');
    game.setPlayer(unit);
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Applies a buff and lets the unit fold it into its action state. */
  function apply(buff: { activateBuff(): void }) {
    unit.addBuff(buff as never);
    unit.updateBuffs();
  }

  const terrainIgnored = () => hasFlag(unit.stats.actionState, ActionState.IS_GHOSTED);
  const bodiesIgnored = () => !unit.collidesWithUnits;

  it('a solid unit collides with both', () => {
    expect(bodiesIgnored()).toBe(false);
    expect(terrainIgnored()).toBe(false);
  });

  it('Phasing passes bodies but is still stopped by walls', () => {
    apply(new Phasing(2_000, unit, unit));

    expect(bodiesIgnored()).toBe(true);
    // the whole reason this flag exists: terrain must still apply
    expect(terrainIgnored()).toBe(false);
  });

  it('a Dash still passes both, so displacements keep working', () => {
    const dash = new Dash(500, unit, unit);
    dash.showTrail = false;
    apply(dash);

    expect(bodiesIgnored()).toBe(true);
    expect(terrainIgnored()).toBe(true);
  });

  it('gives the collision back when it ends', () => {
    const buff = new Phasing(2_000, unit, unit);
    apply(buff);
    expect(bodiesIgnored()).toBe(true);

    buff.deactivateBuff();
    unit.updateBuffs();

    expect(bodiesIgnored()).toBe(false);
  });
});
