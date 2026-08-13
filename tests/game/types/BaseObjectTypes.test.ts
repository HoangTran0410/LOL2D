import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import GameObject from '../../../src/game/gameObject/GameObject';
import type { GameObjectGameContext } from '../../../src/game/gameObject/GameObject';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import ObjectManager, { PredefinedFilters } from '../../../src/game/managers/ObjectManager';
import gameObjectSource from '../../../src/game/gameObject/GameObject.ts?raw';
import spellObjectSource from '../../../src/game/gameObject/SpellObject.ts?raw';
import objectManagerSource from '../../../src/game/managers/ObjectManager.ts?raw';

const scopedSources = [gameObjectSource, spellObjectSource, objectManagerSource];

class TestObject extends GameObject {
  added = 0;
  removed = 0;
  updates = 0;

  onAdded() { this.added += 1; }
  onRemoved() { this.removed += 1; }
  update() { this.updates += 1; }
}

describe('base object type boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y, set: vi.fn() }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not use explicit any in base object production files', () => {
    for (const source of scopedSources) {
      expect(source).not.toMatch(/\bany\b/);
    }
  });

  it('keeps optional base ownership honest', () => {
    expect(gameObjectSource).not.toMatch(/game!/);
    expect(spellObjectSource).not.toMatch(/owner!/);
    expect(new GameObject().game).toBeUndefined();
    expect(new SpellObject<undefined>(undefined).owner).toBeUndefined();
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
    const broad = manager.queryObjects({ filters: [PredefinedFilters.id('first')] });

    expectTypeOf(broad).toEqualTypeOf<GameObject[]>();
    expectTypeOf(typed).toEqualTypeOf<TestObject[]>();
    expectTypeOf(lateGuard).toEqualTypeOf<GameObject[]>();

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
});
