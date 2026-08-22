/**
 * You cannot target what you cannot see.
 *
 * Every auto-locking spell in the game picked its victim out of a plain
 * `queryObjects` circle, which knows about teams, death and targetability and
 * nothing at all about the fog the player is looking at. So Warwick R, standing
 * in the jungle with a wall between him and the blue camp — a screen showing
 * nothing but fog — still found the buff, still passed `checkCastCondition`,
 * and still leaped through the wall to bite it.
 *
 * `combat/Vision.ts` is the answer to "can this unit see that one", and it is
 * deliberately the *same* answer `FogOfWar` paints: walls and bushes block
 * sight, the bush you are standing in does not, and a friendly ward is an eye
 * like any other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { canSee, hasLineOfSight } from '../../../src/game/combat/Vision';
import { Quadtree, Rectangle } from '../../../src/libs/quadtree';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { packIsInstalled } from '../../support/installedPacks';

const __api = buildContentApi();

/**
 * The two riot-pack spells this file uses as real subjects — a ward to borrow
 * sight from, and the ultimate whose acquisition the fog is supposed to gate —
 * reached with a *lazy, gated* import so the other fourteen cases in this file,
 * which are `hasLineOfSight` and `canSee` against walls, bushes and water and
 * have nothing to do with any pack, still run in a checkout that has no riot
 * pack.
 *
 * These used to be plain static imports at the top of this file, and one
 * static import is enough to make the whole file unloadable: batch 5 task 8's
 * first round excluded all nineteen of these tests over two lines. A dynamic
 * `import()` that is never evaluated is inert — Vite leaves the specifier alone
 * and nothing resolves it — so the ternaries are what do the work, and
 * `packIsInstalled` is what the exclusion scanner reads to know this file has
 * handled the pack's absence itself.
 *
 * Warwick R is in this file rather than the pack's own suite for a reason
 * worth keeping: it is the ability that found the bug — leaping to the blue
 * camp through a jungle wall — and the rule it proves (`PredefinedFilters.visibleTo`
 * gates acquisition) is core's, not the pack's.
 */
const Warwick_R = packIsInstalled('riot')
  ? (await import('../../../packs/riot/spells/Warwick_R')).default(__api)
  : null;
const StealthWard_Object = packIsInstalled('riot')
  ? (await import('../../../packs/riot/spells/StealthWard')).makeStealthWard_Object(__api)
  : null;

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Vertices = { x: number; y: number }[];

/** A rectangle of terrain, given as the polygon `TerrainMap` would hand back. */
const slab = (x: number, y: number, w: number, h: number): Vertices => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/**
 * Stubs the map with a fixed obstacle list. The real `getObstaclesInArea`
 * narrows by quadtree first; that is an optimisation, and handing every
 * obstacle to the code under test is the stricter test of the geometry.
 */
const terrain = (obstacles: { type: string; vertices: Vertices }[]) => {
  (game as unknown as { terrainMap: unknown }).terrainMap = {
    getObstaclesInArea: (_area: unknown, types: string[] = []) =>
      obstacles.filter(o => !types.length || types.includes(o.type)),
  };
};

const champion = (teamId: string, x: number, y = 0): Champion => {
  const unit = new Champion({ game, teamId });
  unit.position.set(x, y);
  unit.destination.set(x, y);
  // `getDisplayBoundingBox` reads `isAllied`, which reads `game.player`, so the
  // fixture's world needs one before anything can be indexed.
  try {
    game.player;
  } catch {
    game.setPlayer(unit);
  }
  return unit;
};

describe('hasLineOfSight', () => {
  it('is blocked by a wall standing across the line', () => {
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);
    expect(hasLineOfSight(game, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(false);
  });

  it('is clear when the same wall is off to one side', () => {
    terrain([{ type: 'wall', vertices: slab(100, 400, 40, 200) }]);
    expect(hasLineOfSight(game, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(true);
  });

  it('is clear out of the bush the looker is standing in', () => {
    // FogOfWar drops exactly these from its blocker set, and the two must agree
    // or a champion in a bush would be targetable by nobody including himself.
    terrain([{ type: 'bush', vertices: slab(-50, -50, 100, 100) }]);
    expect(hasLineOfSight(game, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(true);
  });

  it('is blocked by a bush the looker is outside of', () => {
    terrain([{ type: 'bush', vertices: slab(100, -100, 80, 200) }]);
    expect(hasLineOfSight(game, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(false);
  });

  it('ignores water, which nothing has ever hidden behind', () => {
    terrain([{ type: 'water', vertices: slab(100, -100, 40, 200) }]);
    expect(hasLineOfSight(game, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(true);
  });

  it('is clear when the context has no map at all', () => {
    expect(hasLineOfSight(game, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(true);
  });

  /**
   * The thing the stub above cannot check: what a real quadtree hands back.
   *
   * Narrowing is only ever an optimisation here — `polyLine` does the exact
   * test on whatever comes back — so the only way the tree can change an answer
   * is by losing a wall, and then every sightline reads as clear with all of
   * the tests above still green, because those hand the obstacles over
   * directly.
   *
   * The lossy shape is a `Line` query area, which was the first thing tried:
   * the final filter is `CollideUtils.lineRect`, four edge crossings with no
   * containment case, so a sightline lying entirely *inside* a wall's bounding
   * box crosses nothing and the wall is dropped. That is every short sightline
   * beside a big wall — a jungler's whole world. Both cases below are drawn
   * inside the wall's bounding box for exactly that reason.
   */
  it('does not lose a wall the sightline is boxed inside of', () => {
    // A triangle, so the bounding box is half again bigger than the wall and
    // both sightlines below fit inside it. Convex on purpose: the containment
    // check is SAT's, which is only reliable for convex polygons — see the note
    // on `pointPolygon` in Vision.ts.
    const wall = {
      type: 'wall',
      vertices: [
        { x: 100, y: 100 },
        { x: 300, y: 400 },
        { x: 100, y: 400 },
      ],
    };
    const tree = new Quadtree({ x: 0, y: 0, w: 2_000, h: 2_000 });
    tree.insert(new Rectangle({ x: 100, y: 100, w: 200, h: 300, data: wall }));

    (game as unknown as { terrainMap: unknown }).terrainMap = {
      // The shape of the real method, delegating to a real tree.
      getObstaclesInArea: (area: unknown, types: string[] = []) =>
        tree
          .retrieve(area as never)
          .map((region: { data: typeof wall }) => region.data)
          .filter(o => !types.length || types.includes(o.type)),
    };

    // Across the hypotenuse, from outside the wall to inside it.
    expect(hasLineOfSight(game, { x: 150, y: 150 }, { x: 150, y: 250 })).toBe(false);
    // Over the empty corner of the same box, crossing nothing — so the answer
    // is not simply always "blocked" once the wall is in the result set.
    expect(hasLineOfSight(game, { x: 150, y: 150 }, { x: 250, y: 150 })).toBe(true);
  });
});

describe('canSee', () => {
  it('sees an enemy standing in the open', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    indexObjects(game, [looker, enemy]);

    expect(canSee(looker, enemy)).toBe(true);
  });

  it('does not see one behind a wall', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    indexObjects(game, [looker, enemy]);
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);

    expect(canSee(looker, enemy)).toBe(false);
  });

  it('says nothing about distance, which is Reach.ts', () => {
    // Every caller arrives holding a candidate its own query already bounded.
    // A second cap here would have trimmed Warwick R from 550 to the 500 the
    // camera happens to use.
    const looker = champion('blue', 0);
    const enemy = champion('red', 5_000);
    indexObjects(game, [looker, enemy]);

    expect(canSee(looker, enemy)).toBe(true);
  });

  it('still sees for a unit that grants no vision of its own', () => {
    // Minions, camps and turrets all zero `visionRadius` so they paint no fog.
    // They can plainly still see the champion standing next to them.
    const blind = champion('blue', 0);
    blind.stats.visionRadius.baseValue = 0;
    const enemy = champion('red', 300);
    indexObjects(game, [blind, enemy]);

    expect(canSee(blind, enemy)).toBe(true);

    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);
    expect(canSee(blind, enemy)).toBe(false);
  });

  it('does not see one hiding in a bush', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    enemy.isInsideBush = true;
    indexObjects(game, [looker, enemy]);

    expect(canSee(looker, enemy)).toBe(false);
  });

  it('sees into the bush it is standing in itself', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    looker.isInsideBush = true;
    enemy.isInsideBush = true;
    indexObjects(game, [looker, enemy]);

    expect(canSee(looker, enemy)).toBe(true);
  });

  it.skipIf(!StealthWard_Object)('sees through a friendly ward on the far side of the wall', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    const ward = new StealthWard_Object!(looker);
    ward.position.set(280, 0);
    indexObjects(game, [looker, enemy, ward]);
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);

    expect(canSee(looker, enemy)).toBe(true);
  });

  it.skipIf(!StealthWard_Object)('borrows the ward only as far as the ward itself sees', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    const ward = new StealthWard_Object!(looker);
    ward.position.set(-2_000, 0);
    indexObjects(game, [looker, enemy, ward]);
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);

    expect(canSee(looker, enemy)).toBe(false);
  });

  it.skipIf(!StealthWard_Object)('does not borrow an enemy ward for the same trick', () => {
    const looker = champion('blue', 0);
    const enemy = champion('red', 300);
    const ward = new StealthWard_Object!(enemy);
    ward.position.set(280, 0);
    indexObjects(game, [looker, enemy, ward]);
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);

    expect(canSee(looker, enemy)).toBe(false);
  });

  it('always sees a structure, which stays on the map once found', () => {
    const looker = champion('blue', 0);
    const tower = champion('red', 300);
    tower.alwaysVisible = true;
    indexObjects(game, [looker, tower]);
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);

    expect(canSee(looker, tower)).toBe(true);
  });
});

describe('Warwick R', () => {
  /** The reported bug, as the game states it. */
  it.skipIf(!Warwick_R)('will not lock onto a camp on the far side of a wall', () => {
    const warwick = champion('blue', 0);
    const camp = champion('red', 300);
    warwick.stats.mana.baseValue = 500;
    const ultimate = new Warwick_R!(warwick);
    warwick.spells = [ultimate];
    // R picks the enemy nearest the cursor, so point it straight at the camp:
    // the only thing left to refuse the cast is the wall.
    (game as unknown as { worldMouse: unknown }).worldMouse = { x: 300, y: 0 };
    indexObjects(game, [warwick, camp]);
    terrain([{ type: 'wall', vertices: slab(100, -100, 40, 200) }]);

    expect(ultimate.checkCastCondition()).toBe(false);
  });

  it.skipIf(!Warwick_R)('locks on once nothing is in the way', () => {
    const warwick = champion('blue', 0);
    const camp = champion('red', 300);
    warwick.stats.mana.baseValue = 500;
    const ultimate = new Warwick_R!(warwick);
    warwick.spells = [ultimate];
    (game as unknown as { worldMouse: unknown }).worldMouse = { x: 300, y: 0 };
    indexObjects(game, [warwick, camp]);
    terrain([]);

    expect(ultimate.checkCastCondition()).toBe(true);
  });
});
