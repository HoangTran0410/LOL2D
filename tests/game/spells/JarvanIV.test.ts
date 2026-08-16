import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import JarvanIV_Q from '../../../src/game/gameObject/spells/JarvanIV_Q';
import JarvanIV_W from '../../../src/game/gameObject/spells/JarvanIV_W';
import JarvanIV_E from '../../../src/game/gameObject/spells/JarvanIV_E';
import JarvanIV_R from '../../../src/game/gameObject/spells/JarvanIV_R';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

describe('Jarvan IV Spells', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
    vi.stubGlobal('HALF_PI', Math.PI / 2);
    vi.stubGlobal('PI', Math.PI);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('casts Jarvan IV E flag', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const e = new JarvanIV_E(owner);
    e.onSpellCast();
    expect(game.objectManager._objectToBeAdd.length).toBeGreaterThan(0);
  });

  it('casts Jarvan IV Q spear', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const q = new JarvanIV_Q(owner);
    q.onSpellCast();
    expect(game.objectManager._objectToBeAdd.length).toBeGreaterThan(0);
  });

  it('casts Jarvan IV W shield', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const w = new JarvanIV_W(owner);
    w.onSpellCast();
    expect(owner.buffs.length).toBeGreaterThan(0);
  });

  it('casts Jarvan IV R arena', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const r = new JarvanIV_R(owner);
    r.onSpellCast();
    expect(owner.buffs.length).toBeGreaterThan(0);
  });
});
