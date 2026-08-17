import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubGameGlobals } from '../fixtures';
import { Circle, Line, Rectangle } from '../../../src/libs/quadtree';
import {
  createDebugFlags,
  drawDebugOverlay,
  quadtreeNodeBounds,
  type DebugFlags,
  type DebugOverlayHost,
} from '../../../src/game/debug/DebugOverlay';

/**
 * The debug hub: a flag set, and one draw function per flag that surfaces
 * something the game already computed.
 *
 * Every drawing test asserts the pair — something painted with the flag on,
 * and **nothing at all** with it off. Only the off-case can fail against a
 * draw function that ignores its flag, which is the bug this file exists to
 * catch; the on-case alone would pass against an overlay permanently on.
 */

let spies: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  spies = stubGameGlobals();
});
afterEach(() => vi.unstubAllGlobals());

/** Every drawing call the overlay could possibly make, so "nothing" means nothing. */
const drawCalls = (): number =>
  ['rect', 'line', 'circle', 'ellipse', 'beginShape', 'vertex', 'endShape', 'text'].reduce(
    (total, name) => total + spies[name].mock.calls.length,
    0
  );

const unit = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  position: { x, y },
  visibleToPlayerTeam: true,
  visionRadius: 500,
  getCollideBoundingBox: () => new Circle({ x, y, r: 30 }),
  ...extra,
});

/** A tree two levels deep, built by hand: the helper is pure, so no ObjectManager. */
const tree = () => ({
  bounds: { x: 0, y: 0, w: 100, h: 100 },
  level: 0,
  nodes: [
    { bounds: { x: 50, y: 0, w: 50, h: 50 }, level: 1, nodes: [] },
    { bounds: { x: 0, y: 0, w: 50, h: 50 }, level: 1, nodes: [] },
  ],
});

function host(flags: Partial<DebugFlags> = {}): DebugOverlayHost {
  const debug = createDebugFlags({ navigation: { debugRoutes: false } });
  Object.assign(debug, flags);
  return {
    director: { debug },
    terrainMap: {
      wallPolygons: () => [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
    },
    objectManager: {
      objects: [unit(100, 100), unit(200, 200)],
      _objectsTree: tree(),
    },
    fogOfWar: {
      getSightPoly: () => [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  } as unknown as DebugOverlayHost;
}

describe('createDebugFlags', () => {
  it('makes routes one value with navigation.debugRoutes, in both directions', () => {
    const navigation = { debugRoutes: false };
    const flags = createDebugFlags({ navigation });

    expect(flags.routes).toBe(false);

    // The N key's side: Game.keyPressed flips the navigation field.
    navigation.debugRoutes = true;
    expect(flags.routes).toBe(true);

    // The panel's side: the toggle writes the flag.
    flags.routes = false;
    expect(navigation.debugRoutes).toBe(false);
  });

  it('starts every flag off — N on boot must leave the overlay off', () => {
    const flags = createDebugFlags({ navigation: { debugRoutes: false } });
    expect(flags).toMatchObject({
      routes: false,
      terrain: false,
      collision: false,
      vision: false,
      quadtree: false,
    });
  });
});

describe('quadtreeNodeBounds', () => {
  it('walks the whole tree, root included', () => {
    expect(quadtreeNodeBounds(tree())).toEqual([
      { x: 0, y: 0, w: 100, h: 100, level: 0 },
      { x: 50, y: 0, w: 50, h: 50, level: 1 },
      { x: 0, y: 0, w: 50, h: 50, level: 1 },
    ]);
  });

  it('handles an unsplit tree', () => {
    const leaf = { bounds: { x: 0, y: 0, w: 8, h: 8 }, level: 0, nodes: [] };
    expect(quadtreeNodeBounds(leaf)).toHaveLength(1);
  });
});

describe('drawDebugOverlay', () => {
  it('draws nothing at all with every flag off', () => {
    drawDebugOverlay(host());
    expect(drawCalls()).toBe(0);
  });

  it('terrain: paints wall polygons on, nothing off', () => {
    drawDebugOverlay(host({ terrain: true }));
    expect(spies.beginShape).toHaveBeenCalled();
    expect(spies.vertex).toHaveBeenCalledTimes(3);

    vi.clearAllMocks();
    drawDebugOverlay(host({ terrain: false }));
    expect(drawCalls()).toBe(0);
  });

  it('collision: paints a body per object on, nothing off', () => {
    drawDebugOverlay(host({ collision: true }));
    expect(spies.circle).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    drawDebugOverlay(host({ collision: false }));
    expect(drawCalls()).toBe(0);
  });

  it('collision: draws whichever shape the body reports', () => {
    const shapes = host({ collision: true });
    shapes.objectManager.objects = [
      unit(0, 0, { getCollideBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 10, h: 10 }) }),
      unit(0, 0, { getCollideBoundingBox: () => new Line({ x1: 0, y1: 0, x2: 5, y2: 5 }) }),
      // A body with no bounding box at all: ObjectManager guards for this, so
      // the overlay has to as well rather than throwing mid-frame.
      { position: { x: 0, y: 0 } },
    ] as never;
    drawDebugOverlay(shapes);

    expect(spies.rect).toHaveBeenCalledTimes(1);
    expect(spies.line).toHaveBeenCalledTimes(1);
    expect(spies.circle).not.toHaveBeenCalled();
  });

  it('vision: paints each visible unit sight polygon on, and off does not even ask the fog', () => {
    const on = host({ vision: true });
    const asked = vi.fn(() => [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    on.fogOfWar = { getSightPoly: asked } as never;
    drawDebugOverlay(on);
    expect(asked).toHaveBeenCalledTimes(2);
    expect(spies.beginShape).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    const off = host({ vision: false });
    const notAsked = vi.fn(() => []);
    off.fogOfWar = { getSightPoly: notAsked } as never;
    drawDebugOverlay(off);
    // The flag is checked before the loop, not inside it: an overlay that is
    // off must cost nothing, and getSightPoly recomputes a visibility polygon.
    expect(notAsked).not.toHaveBeenCalled();
    expect(drawCalls()).toBe(0);
  });

  it('vision: skips units the fog is not showing', () => {
    const one = host({ vision: true });
    one.objectManager.objects = [
      unit(0, 0),
      unit(10, 10, { visibleToPlayerTeam: false }),
      unit(20, 20, { visionRadius: 0 }),
    ] as never;
    drawDebugOverlay(one);
    expect(spies.beginShape).toHaveBeenCalledTimes(1);
  });

  it('quadtree: paints a rect per node on, nothing off', () => {
    drawDebugOverlay(host({ quadtree: true }));
    expect(spies.rect).toHaveBeenCalledTimes(3);

    vi.clearAllMocks();
    drawDebugOverlay(host({ quadtree: false }));
    expect(drawCalls()).toBe(0);
  });

  it('routes is not drawn here — drawNavDebug already owns it', () => {
    const flags = host();
    flags.director.debug.routes = true;
    drawDebugOverlay(flags);
    expect(drawCalls()).toBe(0);
  });
});
