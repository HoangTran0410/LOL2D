/**
 * Spell-made terrain is terrain.
 *
 * Anivia W and Jarvan R put real, impassable slabs on the map — both push units
 * out of themselves every frame, exactly as `TerrainMap.pushOutOfWalls` does for
 * the map's own walls. But they are `SpellObject`s in the object manager, and
 * `TerrainMap` only ever knew about the polygons parsed out of
 * `summoner_map.json`. So every ability that *asks about walls* asked the wrong
 * thing: Camille's grapple flew straight through an ice wall it should have
 * caught on, and Janna's monsoon shoved people through Jarvan's arena.
 *
 * `wallOutlinesInArea` is the one question both kinds of wall answer. The
 * source scan at the bottom is what stops the next terrain-reading spell from
 * quietly going back to asking only half of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import { pointInWall, wallOutlinesInArea } from '../../../src/game/gameObject/map/DynamicTerrain';
import { Rectangle } from '../../../src/libs/quadtree';
import { createGame, indexObjects, stubGameGlobals, withWalls, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { makeAnivia_W_Object } from '../../../packs/riot/spells/Anivia_W';
import { makeJarvanIV_R_WallObject } from '../../../packs/riot/spells/JarvanIV_R';
import makeCamille_E, { makeCamille_E_GrappleObject } from '../../../packs/riot/spells/Camille_E';
const __api = buildContentApi();
const Anivia_W_Object = makeAnivia_W_Object(__api);
const JarvanIV_R_WallObject = makeJarvanIV_R_WallObject(__api);
const Camille_E = makeCamille_E(__api);
const Camille_E_GrappleObject = makeCamille_E_GrappleObject(__api);

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  // The fixture has no `TerrainMap`; every test here is about the *other* half,
  // so a map with no walls in it is the honest stand-in for "no static wall
  // nearby". It has to be a real terrain field rather than a bare stub, because
  // `sweepToWall` reaches spell-made walls *through* the field — one seam for
  // both kinds is the point, and it costs the fixture one empty grid.
  withWalls(game, []);
});
afterEach(() => vi.unstubAllGlobals());

const owner = (): Champion => {
  const unit = new Champion({ game, teamId: 'caster' });
  unit.position.set(0, 0);
  unit.destination.set(0, 0);
  game.setPlayer(unit);
  return unit;
};

/** An ice wall standing across x = 300, 260 long on the y axis. */
const iceWall = (caster: Champion): Anivia_W_Object => {
  const wall = new Anivia_W_Object(caster);
  wall.position = createVector(300, 0) as unknown as p5.Vector;
  wall.angle = Math.PI / 2;
  wall.length = 260;
  wall.thickness = 34;
  return wall;
};

/** One Cataclysm slab, in the same place and orientation. */
const earthWall = (caster: Champion): JarvanIV_R_WallObject => {
  const wall = new JarvanIV_R_WallObject(caster);
  wall.position = createVector(300, 0) as unknown as p5.Vector;
  wall.angle = Math.PI / 2;
  wall.length = 150;
  wall.thickness = 36;
  return wall;
};

const wholeMap = () => new Rectangle({ x: -1_000, y: -1_000, w: 2_000, h: 2_000 });

describe('wallOutlinesInArea', () => {
  it('reports an ice wall as terrain', () => {
    const caster = owner();
    const wall = iceWall(caster);
    indexObjects(game, [caster, wall]);

    expect(wallOutlinesInArea(game, wholeMap())).toHaveLength(1);
  });

  it('reports a risen Cataclysm slab as terrain', () => {
    const caster = owner();
    const wall = earthWall(caster);
    wall.eruptDelay = 0;
    indexObjects(game, [caster, wall]);

    expect(wallOutlinesInArea(game, wholeMap())).toHaveLength(1);
  });

  it('ignores a slab that is still underground', () => {
    const caster = owner();
    const wall = earthWall(caster);
    wall.eruptDelay = 400;
    wall.age = 100;
    indexObjects(game, [caster, wall]);

    // Nothing has broken the surface: it does not draw, it does not block, and
    // a grapple must not catch on it either.
    expect(wallOutlinesInArea(game, wholeMap())).toEqual([]);
  });

  it('ignores a slab the recast has brought down', () => {
    const caster = owner();
    const wall = earthWall(caster);
    wall.eruptDelay = 0;
    indexObjects(game, [caster, wall]);
    expect(wallOutlinesInArea(game, wholeMap())).toHaveLength(1);

    wall.collapse();
    expect(wallOutlinesInArea(game, wholeMap())).toEqual([]);
  });

  it('places the outline where the slab actually is', () => {
    const caster = owner();
    indexObjects(game, [caster, iceWall(caster)]);

    // The slab is rotated a quarter turn at (300, 0): 34 thick across x, 260
    // long down y. Written out rather than recomputed from the same rotation
    // the code under test uses — a transform asked to check itself agrees with
    // itself however wrong it is.
    expect(pointInWall(game, 300, 0)).toBe(true);
    expect(pointInWall(game, 300, 120)).toBe(true);
    expect(pointInWall(game, 300, -120)).toBe(true);
    expect(pointInWall(game, 300, 200)).toBe(false);
    expect(pointInWall(game, 360, 0)).toBe(false);
  });
});

describe('Camille E hooks spell-made walls', () => {
  /** Flies the grapple forward until it catches or gives up. */
  const fly = (grapple: Camille_E_GrappleObject) => {
    for (let i = 0; i < 200 && !grapple.toRemove; i++) grapple.update();
  };

  const grappleAt = (caster: Champion, spell: Camille_E) => {
    const grapple = new Camille_E_GrappleObject(caster, spell);
    grapple.position.set(0, 0);
    grapple.destination.set(700, 0);
    return grapple;
  };

  it('catches on an Anivia ice wall', () => {
    const camille = owner();
    const spell = new Camille_E(camille);
    const wall = iceWall(camille);
    const grapple = grappleAt(camille, spell);
    indexObjects(game, [camille, wall, grapple]);

    fly(grapple);

    // The hook is spent and the pull is a real Dash, not a position write.
    expect(grapple.toRemove).toBe(true);
    expect(camille.buffs.some(buff => buff instanceof Dash)).toBe(true);
  });

  it('catches on a Jarvan Cataclysm slab', () => {
    const camille = owner();
    const spell = new Camille_E(camille);
    const wall = earthWall(camille);
    wall.eruptDelay = 0;
    const grapple = grappleAt(camille, spell);
    indexObjects(game, [camille, wall, grapple]);

    fly(grapple);

    expect(grapple.toRemove).toBe(true);
    expect(camille.buffs.some(buff => buff instanceof Dash)).toBe(true);
  });

  it('flies past empty ground without attaching', () => {
    const camille = owner();
    const spell = new Camille_E(camille);
    const grapple = grappleAt(camille, spell);
    indexObjects(game, [camille, grapple]);

    fly(grapple);

    expect(spell.attachedToWall).toBe(false);
    expect(camille.buffs.some(buff => buff instanceof Dash)).toBe(false);
  });
});

describe('every terrain-reading spell reads both kinds', () => {
  it('no spell asks TerrainMap for walls on its own', () => {
    const dir = join(process.cwd(), 'packs/riot/spells');
    const offenders: string[] = [];

    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(join(dir, name), 'utf8')
        // strip comments, or this scan flags its own documentation
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/terrainMap\s*[?.]*\s*\.\s*getObstacles/.test(source)) offenders.push(name);
    }

    // `wallOutlinesInArea` is the one query that sees map terrain *and* the
    // walls other spells put down. Going straight to `terrainMap` sees only
    // half the walls on the map, which is the bug this file exists for.
    expect(offenders).toEqual([]);
  });
});
