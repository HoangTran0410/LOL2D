import { describe, expect, it } from 'vitest';
import { Quadtree, Rectangle } from '../../src/libs/quadtree';

// Quadtree.retrieve used to dedupe with
// `returnObjects.filter((item, i) => returnObjects.indexOf(item) >= i)`,
// an O(n^2) scan. It was rewritten to use a Set, but must keep returning the
// same set (each object once) in the same first-occurrence order.
describe('Quadtree.retrieve', () => {
  it('returns an object spanning multiple quadrants exactly once', () => {
    const tree = new Quadtree({ x: 0, y: 0, w: 100, h: 100, maxObjects: 1, maxLevels: 4 });

    // Two objects in the same corner push the root past maxObjects so it
    // splits into 4 child nodes before the shared object is inserted.
    tree.insert(new Rectangle({ x: 1, y: 1, w: 1, h: 1, data: 'a' }));
    tree.insert(new Rectangle({ x: 2, y: 2, w: 1, h: 1, data: 'b' }));

    // Straddles the root's center (50, 50), so qtIndex matches all 4
    // quadrants and the object is inserted into every child node.
    const shared = new Rectangle({ x: 45, y: 45, w: 10, h: 10, data: 'shared' });
    tree.insert(shared);

    const query = new Rectangle({ x: 0, y: 0, w: 100, h: 100 });
    const results = tree.retrieve(query);

    expect(results.filter((r) => r.data === 'shared')).toHaveLength(1);
  });

  it('still filters out objects that do not actually intersect the query area', () => {
    const tree = new Quadtree({ x: 0, y: 0, w: 100, h: 100, maxObjects: 10, maxLevels: 4 });
    tree.insert(new Rectangle({ x: 0, y: 0, w: 5, h: 5, data: 'near' }));
    tree.insert(new Rectangle({ x: 90, y: 90, w: 5, h: 5, data: 'far' }));

    const query = new Rectangle({ x: 0, y: 0, w: 10, h: 10 });
    const results = tree.retrieve(query);

    expect(results.map((r) => r.data)).toEqual(['near']);
  });

  it('keeps first-occurrence order for objects retrieved from a single leaf', () => {
    const tree = new Quadtree({ x: 0, y: 0, w: 100, h: 100, maxObjects: 10, maxLevels: 4 });
    tree.insert(new Rectangle({ x: 1, y: 1, w: 1, h: 1, data: 'first' }));
    tree.insert(new Rectangle({ x: 2, y: 2, w: 1, h: 1, data: 'second' }));
    tree.insert(new Rectangle({ x: 3, y: 3, w: 1, h: 1, data: 'third' }));

    const query = new Rectangle({ x: 0, y: 0, w: 10, h: 10 });
    const results = tree.retrieve(query);

    expect(results.map((r) => r.data)).toEqual(['first', 'second', 'third']);
  });
});
