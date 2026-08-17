import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import GameObject from '../../../src/game/gameObject/GameObject';
import type {
  GameObjectGameContext,
  GameObjectRuntimeContext,
} from '../../../src/game/gameObject/GameObject';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import ObjectManager, { PredefinedFilters } from '../../../src/game/managers/ObjectManager';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import CombatText from '../../../src/game/gameObject/helpers/CombatText';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import TrailSystem from '../../../src/game/gameObject/helpers/TrailSystem';
import EventManager from '../../../src/managers/EventManager';
import gameObjectSource from '../../../src/game/gameObject/GameObject.ts?raw';
import spellObjectSource from '../../../src/game/gameObject/SpellObject.ts?raw';
import objectManagerSource from '../../../src/game/managers/ObjectManager.ts?raw';
import particleSystemSource from '../../../src/game/gameObject/helpers/ParticleSystem.ts?raw';
import trailSystemSource from '../../../src/game/gameObject/helpers/TrailSystem.ts?raw';

const scopedSources = [gameObjectSource, spellObjectSource, objectManagerSource];

class TestObject extends GameObject {
  added = 0;
  removed = 0;
  updates = 0;

  onAdded() {
    this.added += 1;
  }
  onRemoved() {
    this.removed += 1;
  }
  update() {
    this.updates += 1;
  }
}

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy() {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
}

function createGame(): GameObjectRuntimeContext {
  const camera = { getBoundingBox: () => new Rectangle({ x: -50, y: -50, w: 100, h: 100 }) };
  const objectManager = new ObjectManager({ mapSize: 100, camera });
  let player: AttackableUnit | undefined;
  return {
    mapSize: 100,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) player = new AttackableUnit({ game: this });
      return player;
    },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
  };
}

describe('base object type boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not use explicit any in base object production files', () => {
    for (const source of scopedSources) {
      expect(source).not.toMatch(/\bany\b/);
    }
  });

  /**
   * `squareDisplayBoundingBox` is the one memoised box every square-boxed
   * subclass now shares (GameObject, AttackableUnit, Minion, MinionSwing,
   * Turret). Each of those used to hand-roll `new Rectangle`, which is an
   * allocation per object per call on a path that runs at least three times a
   * frame per object — quadtree rebuild, draw cull, and every targeting
   * candidate. These two cases are the whole contract: reuse while the inputs
   * hold, and rebuild the moment either input moves.
   */
  it('reuses one display box until position or size changes', () => {
    const object = new GameObject({ visionRadius: 30 });

    const first = object.getDisplayBoundingBox();
    expect(object.getDisplayBoundingBox()).toBe(first);
    expect([first.x, first.y, first.w, first.h]).toEqual([-30, -30, 60, 60]);

    object.position.set(10, 5);
    const moved = object.getDisplayBoundingBox();
    expect(moved).not.toBe(first);
    expect([moved.x, moved.y, moved.w, moved.h]).toEqual([-20, -25, 60, 60]);

    object.visionRadius = 10;
    const resized = object.getDisplayBoundingBox();
    expect(resized).not.toBe(moved);
    expect([resized.x, resized.y, resized.w, resized.h]).toEqual([0, -5, 20, 20]);
  });

  /**
   * The box carries `data`, and the quadtree hands that straight back as the
   * retrieved object — a cached box that lost it would make every spatial
   * query return undefined objects rather than fail loudly.
   */
  it('keeps the owning object on a reused display box', () => {
    const object = new GameObject({ visionRadius: 12 });
    expect(object.getDisplayBoundingBox().data).toBe(object);
    expect(object.getDisplayBoundingBox().data).toBe(object);
  });

  it('keeps base game ownership optional but spell ownership concrete', () => {
    expect(gameObjectSource).not.toMatch(/game!/);
    expect(spellObjectSource).not.toMatch(/owner!/);
    expect(spellObjectSource).not.toContain('class SpellObject<');
    expect(spellObjectSource).toContain('owner: AttackableUnit');
    expect(new GameObject().game).toBeUndefined();

    const owner = new AttackableUnit({ game: createGame() });
    expect(new SpellObject(owner).owner).toBe(owner);
  });

  it('keeps ownerless particle and trail effects outside the spell hierarchy', () => {
    expect(particleSystemSource).toContain('extends GameObject');
    expect(trailSystemSource).toContain('extends GameObject');
    expect(new ParticleSystem({ isDeadFn: () => true }).owner).toBeUndefined();
    expect(new TrailSystem().owner).toBeUndefined();
  });

  it('accepts only the base game context shape', () => {
    const objectManager = new ObjectManager({
      mapSize: 100,
      camera: { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) },
    });
    const context: GameObjectGameContext = { objectManager };

    expect(new GameObject({ game: context }).game).toBe(context);

    if (false) {
      // @ts-expect-error a game context needs an object manager capability
      new GameObject({ game: {} });
      // @ts-expect-error arbitrary objects are not game contexts
      new GameObject({ game: new Date() });
    }
  });

  it('preserves targetability filters for arbitrary game objects', () => {
    const ordinary = new TestObject();
    const targetable = Object.assign(new TestObject(), { targetable: true });

    expect(PredefinedFilters.includeUntargetable(ordinary)).toBe(true);
    expect(PredefinedFilters.excludeUntargetable(ordinary)).toBe(false);
    expect(PredefinedFilters.includeUntargetable(targetable)).toBe(false);
    expect(PredefinedFilters.excludeUntargetable(targetable)).toBe(true);
  });

  it('adds, updates, filters, queries, and removes game objects', () => {
    const manager = new ObjectManager({
      mapSize: 100,
      camera: { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) },
    });
    const first = new TestObject({ visionRadius: 10, id: 'first' });
    const second = new TestObject({ visionRadius: 10, id: 'second' });
    second.position.x = 50;

    manager.addObject(first);
    manager.addObject(second);
    manager.update();

    const found = manager.queryObjects({
      area: new Rectangle({ x: -5, y: -5, w: 20, h: 20 }),
      queryByDisplayBoundingBox: true,
      filters: [PredefinedFilters.id('first')],
    });
    const typed: TestObject[] = manager.queryObjects({
      filters: [PredefinedFilters.type(TestObject)],
      queryByDisplayBoundingBox: true,
    });
    const lateGuard = manager.queryObjects({
      filters: [PredefinedFilters.id('first'), PredefinedFilters.type(TestObject)],
      queryByDisplayBoundingBox: true,
    });
    const lateTyped: TestObject[] = lateGuard;
    const broad = manager.queryObjects({ filters: [PredefinedFilters.id('first')] });

    expectTypeOf(broad).toEqualTypeOf<GameObject[]>();
    expectTypeOf(typed).toEqualTypeOf<TestObject[]>();
    expect(lateTyped).toEqual([first]);

    expect(found).toEqual([first]);
    expect(typed).toEqual([first, second]);
    expect(first.added).toBe(1);
    expect(first.updates).toBe(0);

    manager.update();
    manager.removeObject(first);
    manager.update();

    expect(first.updates).toBe(2);
    expect(first.removed).toBe(1);
    expect(manager.objects).toEqual([second]);
  });

  it('keeps the pre-existing no-area filtered query behavior empty', () => {
    const manager = new ObjectManager({
      mapSize: 100,
      camera: { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) },
    });
    manager.objects = [new TestObject({ id: 'first' })];

    expect(manager.queryObjects({ filters: [PredefinedFilters.id('first')] })).toEqual([]);
  });

  it('draws champions in slot four before combat text in slot five', () => {
    const game = createGame();
    const champion = new Champion({ game });
    const combatText = new CombatText(champion);
    const order: string[] = [];
    champion.draw = () => {
      order.push('champion');
    };
    combatText.draw = () => {
      order.push('combat-text');
    };
    champion.getDisplayBoundingBox = () =>
      new Rectangle({ x: -5, y: -5, w: 10, h: 10, data: champion });
    combatText.getDisplayBoundingBox = () =>
      new Rectangle({ x: -5, y: -5, w: 10, h: 10, data: combatText });
    game.objectManager.objects = [combatText, champion];
    game.objectManager._objectsTree.insert(combatText.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(champion.getDisplayBoundingBox());

    game.objectManager.draw();

    expect(order).toEqual(['champion', 'combat-text']);
  });
});
