import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeCamille_Q from '../../../packs/riot/spells/Camille_Q';
import makeCamille_W from '../../../packs/riot/spells/Camille_W';
import makeCamille_E from '../../../packs/riot/spells/Camille_E';
import makeCamille_R from '../../../packs/riot/spells/Camille_R';
const __api = buildContentApi();
const Camille_Q = makeCamille_Q(__api);
const Camille_W = makeCamille_W(__api);
const Camille_E = makeCamille_E(__api);
const Camille_R = makeCamille_R(__api);

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

describe('Camille Spells', () => {
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

  it('casts Camille Q empowered attack', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const q = new Camille_Q(owner);
    q.onSpellCast();
    expect(owner.buffs.length).toBeGreaterThan(0);
  });

  it('casts Camille W sweep', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const w = new Camille_W(owner);
    w.onSpellCast();
    expect(game.objectManager._objectToBeAdd.length).toBeGreaterThan(0);
  });

  it('casts Camille E hookshot', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const e = new Camille_E(owner);
    e.onSpellCast();
  });

  it('casts Camille R hextech ultimatum', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(200, 0);
    const owner = unit(game, 0, 'blue');
    const r = new Camille_R(owner);
    r.onSpellCast();
    expect(owner.buffs.length).toBeGreaterThan(0);
  });
});
