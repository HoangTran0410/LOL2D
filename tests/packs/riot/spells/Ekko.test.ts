import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import makeEkko_Q from '../../../../packs/riot/spells/Ekko_Q';
import makeEkko_W from '../../../../packs/riot/spells/Ekko_W';
import makeEkko_E from '../../../../packs/riot/spells/Ekko_E';
import makeEkko_R from '../../../../packs/riot/spells/Ekko_R';
const __api = buildContentApi();
const Ekko_Q = makeEkko_Q(__api);
const Ekko_W = makeEkko_W(__api);
const Ekko_E = makeEkko_E(__api);
const Ekko_R = makeEkko_R(__api);

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

describe('Ekko Spells', () => {
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

  it('casts Ekko Q and creates Q projectile', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const q = new Ekko_Q(owner);
    q.onSpellCast();
    expect(game.objectManager._objectToBeAdd.length).toBeGreaterThan(0);
  });

  it('casts Ekko W zone', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const w = new Ekko_W(owner);
    w.onSpellCast();
    expect(game.objectManager._objectToBeAdd.length).toBeGreaterThan(0);
  });

  it('casts Ekko E dash and buff', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const e = new Ekko_E(owner);
    e.onSpellCast();
    expect(owner.buffs.length).toBeGreaterThan(0);
  });

  it('casts Ekko R chronobreak teleport & heal', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    owner.stats.health.baseValue = 50;
    const r = new Ekko_R(owner);
    r.onSpellCast();
    expect(owner.stats.health.value).toBeGreaterThan(50);
  });
});
