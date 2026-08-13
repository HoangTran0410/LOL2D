import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import GameObject from '../../../src/game/gameObject/GameObject';
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
