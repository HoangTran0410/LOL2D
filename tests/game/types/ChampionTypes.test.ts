import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import AssetManager from '../../../src/managers/AssetManager';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import DummyChampion from '../../../src/game/gameObject/attackableUnits/DummyChampion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Turret, { TurretBolt } from '../../../src/game/gameObject/structures/Turret';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import Spell from '../../../src/game/gameObject/Spell';
import type { GameObjectRuntimeContext } from '../../../src/game/gameObject/GameObject';
import EventManager from '../../../src/managers/EventManager';
import championSource from '../../../src/game/gameObject/attackableUnits/Champion.ts?raw';
import aiChampionSource from '../../../src/game/gameObject/attackableUnits/AIChampion.ts?raw';
import dummyChampionSource from '../../../src/game/gameObject/attackableUnits/DummyChampion.ts?raw';
import monsterSource from '../../../src/game/gameObject/attackableUnits/Monster.ts?raw';
import turretSource from '../../../src/game/gameObject/structures/Turret.ts?raw';

const scopedSources = [
  championSource,
  aiChampionSource,
  dummyChampionSource,
  monsterSource,
  turretSource,
];

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  add(vector: TestVector) { this.x += vector.x; this.y += vector.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  magSq() { return this.x * this.x + this.y * this.y; }
  setMag(value: number) {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > 0) this.mult(value / magnitude);
    return this;
  }
  dist(vector: TestVector) { return Math.hypot(this.x - vector.x, this.y - vector.y); }
  static sub(a: TestVector, b: TestVector) { return new TestVector(a.x - b.x, a.y - b.y); }
  static dist(a: TestVector, b: TestVector) { return a.dist(b); }
}

function createGame(): GameObjectRuntimeContext {
  const camera = { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) };
  const objectManager = new ObjectManager({ mapSize: 1000, camera });
  let player: AttackableUnit | undefined;

  return {
    mapSize: 1000,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) throw new Error('Player is not available in this test context.');
      return player;
    },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
  };
}

describe('champion and direct-subclass type boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('random', () => 0);
    vi.stubGlobal('deltaTime', 16);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not use explicit any or deprecated asset lookups in scoped production files', () => {
    for (const source of scopedSources) {
      expect(source).not.toMatch(/\bany\b/);
      expect(source).not.toContain('AssetManager.getAsset(');
    }
  });

  it('constructs champion presets with generated avatar handles and owned spells', () => {
    const game = createGame();
    class TestSpell extends Spell {}
    const champion = new Champion({
      game,
      avatar: AssetManager.get('champ_ahri'),
      preset: { name: 'Ahri', spells: [TestSpell] },
    });

    expect(champion.avatar).toBe(AssetManager.get('champ_ahri'));
    expect(champion.name).toBe('Ahri');
    expect(champion.spells[0]).toBeInstanceOf(TestSpell);
    expectTypeOf(champion.spells).toEqualTypeOf<Spell[]>();
  });

  it('keeps champion score attribution and direct-subclass targets concrete', () => {
    const game = createGame();
    const attacker = new Champion({ game });
    const target = new Champion({ game });
    target.die({ attacker, reviveAfter: 10 });

    const monster = new Monster({ game });
    const turret = new Turret({ game, position: createVector() });
    monster.aggroOn(target);
    turret.fireAt(target);

    expect(target.score).toBe(-1);
    expect(attacker.score).toBe(1);
    expect(monster.targetLock).toBe(target);
    expect(monster.findNearestChampion(1)).toBeNull();
    expect(turret.target).toBeNull();
    expect(game.objectManager._objectToBeAdd[0]).toBeInstanceOf(TurretBolt);
    expectTypeOf(monster.targetLock).toEqualTypeOf<Champion | null>();
    expectTypeOf(turret.target).toEqualTypeOf<Champion | null>();
  });

  it('keeps dummy construction and AI respawn preset replacement compatible with typed options', () => {
    const game = createGame();
    const dummy = new DummyChampion({ game, position: createVector() });
    const ai = new AIChampion({ game, preset: { spells: [] } });

    expect(dummy.name).toBe('Hình Nộm');
    expect(ai.spells).toEqual([]);
  });
});
