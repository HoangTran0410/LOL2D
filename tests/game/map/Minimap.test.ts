import { describe, expect, it } from 'vitest';
import {
  EXPANDED_FRACTION,
  MINIMAP_MARGIN,
  MINIMAP_SIZE,
  Minimap,
  hitTest,
  minimapToWorld,
  worldToMinimap,
} from '../../../src/game/gameObject/map/Minimap';

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

// No canvas anywhere in here: the buffers are built lazily inside draw(), so
// everything that decides *where* things are runs headlessly.
const makeMinimap = (width: number, height: number) =>
  new Minimap({
    viewport: () => ({ width, height }),
    mapSize: () => MAP,
    wallPolygons: () => [],
  });

describe('minimap rect', () => {
  it('collapses into the top-left corner at the fixed size', () => {
    expect(makeMinimap(1280, 720).rect).toEqual({
      x: MINIMAP_MARGIN,
      y: MINIMAP_MARGIN,
      size: MINIMAP_SIZE,
    });
  });

  it('expands to a fraction of the shorter side, centred', () => {
    const minimap = makeMinimap(1280, 720);
    minimap.expanded = true;
    const size = 720 * EXPANDED_FRACTION;
    expect(minimap.rect).toEqual({ x: (1280 - size) / 2, y: (720 - size) / 2, size });
  });

  it('takes the shorter side on a portrait viewport too', () => {
    const minimap = makeMinimap(420, 900);
    minimap.expanded = true;
    expect(minimap.rect.size).toBeCloseTo(420 * EXPANDED_FRACTION, 6);
  });

  it('follows a resize', () => {
    const minimap = makeMinimap(1280, 720);
    minimap.expanded = true;
    minimap.resize(800, 800);
    expect(minimap.rect.size).toBeCloseTo(800 * EXPANDED_FRACTION, 6);
  });
});

describe('tap routing', () => {
  it('collapsed: a tap inside expands, a tap outside is not ours', () => {
    const minimap = makeMinimap(1280, 720);
    expect(minimap.route({ x: 60, y: 60 })).toBe('expand');
    expect(minimap.route({ x: 640, y: 400 })).toBe('pass');
  });

  it('expanded: a tap inside teleports, a tap outside dismisses', () => {
    const minimap = makeMinimap(1280, 720);
    minimap.expanded = true;
    expect(minimap.route({ x: 640, y: 360 })).toBe('teleport');
    // There must be a dismiss that is not a teleport, or opening it by
    // accident forces you to teleport somewhere.
    expect(minimap.route({ x: 20, y: 700 })).toBe('collapse');
  });

  it('expanded: the collapsed corner is no longer a special case', () => {
    const minimap = makeMinimap(1280, 720);
    minimap.expanded = true;
    // (60,60) is inside the collapsed rect but outside the expanded one.
    expect(minimap.route({ x: 60, y: 60 })).toBe('collapse');
  });
});

describe('teleport destination', () => {
  // The destination the tap predicts, before any teleport happens.
  it('the centre of the expanded map is the centre of the world', () => {
    const minimap = makeMinimap(1280, 720);
    minimap.expanded = true;
    const target = minimap.worldAt({ x: 640, y: 360 });
    expect(target.x).toBeCloseTo(MAP / 2, 6);
    expect(target.y).toBeCloseTo(MAP / 2, 6);
  });

  it('a tap below centre is south of centre, not north of it', () => {
    const minimap = makeMinimap(1280, 720);
    minimap.expanded = true;
    const size = 720 * EXPANDED_FRACTION;
    const top = minimap.worldAt({ x: 640, y: (720 - size) / 2 });
    const bottom = minimap.worldAt({ x: 640, y: (720 + size) / 2 });
    expect(top.y).toBeCloseTo(0, 6);
    expect(bottom.y).toBeCloseTo(MAP, 6);
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
