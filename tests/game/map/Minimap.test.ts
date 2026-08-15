import { describe, expect, it } from 'vitest';
import { hitTest, minimapToWorld, worldToMinimap } from '../../../src/game/gameObject/map/Minimap';

const MAP = 6400;
const rect = { x: 12, y: 12, size: 150 };

describe('minimap transform', () => {
  // A transform wrong by the same factor both ways round-trips perfectly, so
  // the round trip alone proves nothing. This pins one known absolute.
  it('world origin maps to the rect origin', () => {
    expect(worldToMinimap({ x: 0, y: 0 }, rect, MAP)).toEqual({ x: 12, y: 12 });
  });

  it('the far corner maps to the far corner', () => {
    expect(worldToMinimap({ x: MAP, y: MAP }, rect, MAP)).toEqual({ x: 162, y: 162 });
  });

  it('the centre maps to the centre', () => {
    expect(worldToMinimap({ x: 3200, y: 3200 }, rect, MAP)).toEqual({ x: 87, y: 87 });
  });

  it.each([
    [0, 0],
    [MAP, 0],
    [0, MAP],
    [MAP, MAP],
    [3200, 3200],
    [1234, 5678],
  ])('round-trips (%i, %i) at both rects', (x, y) => {
    for (const r of [rect, { x: 100, y: 60, size: 600 }]) {
      const back = minimapToWorld(worldToMinimap({ x, y }, r, MAP), r, MAP);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  // The axis-inversion bug a round trip cannot see.
  it('y grows downward, like the world', () => {
    const top = worldToMinimap({ x: 0, y: 0 }, rect, MAP);
    const bottom = worldToMinimap({ x: 0, y: MAP }, rect, MAP);
    expect(bottom.y).toBeGreaterThan(top.y);
  });
});

describe('hitTest', () => {
  it('inside hits, one pixel outside does not', () => {
    expect(hitTest({ x: 13, y: 13 }, rect)).toBe(true);
    expect(hitTest({ x: 161, y: 161 }, rect)).toBe(true);
    expect(hitTest({ x: 11, y: 13 }, rect)).toBe(false);
    expect(hitTest({ x: 13, y: 163 }, rect)).toBe(false);
  });
});
