import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { makeCamille_R_Object } from '../../../packs/riot/spells/Camille_R';
import { makeCamille_W_Object } from '../../../packs/riot/spells/Camille_W';
import { makeEkko_R_Object } from '../../../packs/riot/spells/Ekko_R';
import { makeEkko_W_Object } from '../../../packs/riot/spells/Ekko_W';
import { makeJarvanIV_W_WaveObject } from '../../../packs/riot/spells/JarvanIV_W';
import { JARVAN_E_DROP_HEIGHT } from '../../../packs/riot/spells/JarvanIV_E';
import { makeJarvanIV_E_Object } from '../../../packs/riot/spells/JarvanIV_E';
const __api = buildContentApi();
const Camille_R_Object = makeCamille_R_Object(__api);
const Camille_W_Object = makeCamille_W_Object(__api);
const Ekko_R_Object = makeEkko_R_Object(__api);
const Ekko_W_Object = makeEkko_W_Object(__api);
const JarvanIV_W_WaveObject = makeJarvanIV_W_WaveObject(__api);
const JarvanIV_E_Object = makeJarvanIV_E_Object(__api);

/**
 * `GameObject.getDisplayBoundingBox` falls back to `visionRadius`, which is 0 for
 * a plain SpellObject — a zero-area box sitting on the object's own centre. The
 * quadtree query in `ObjectManager.draw` is what decides whether `draw()` is
 * called at all, so an effect that paints a 400px disc but reports a zero-size
 * box vanishes the instant its *centre* leaves the camera, while the damage it
 * already dealt lands normally. Same failure as the Lux R beam, one layer down.
 *
 * Every effect that paints beyond its own centre owes the tree a box that
 * actually contains what it paints.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Half-width of the reported display box: how far off-centre drawing survives. */
function reportedReach(object: { getDisplayBoundingBox(): Box }): number {
  const box = object.getDisplayBoundingBox();
  return Math.min(box.w, box.h) / 2;
}

/** Whether the reported box actually contains a point the effect paints. */
function covers(object: { getDisplayBoundingBox(): Box }, x: number, y: number): boolean {
  const box = object.getDisplayBoundingBox();
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

describe('AoE spell effects report a display box covering what they paint', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = createUnit(game, 0, 'blue');
    owner.stats.size.baseValue = 20;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Camille R hextech field covers its trap radius', () => {
    const object = new Camille_R_Object(owner);
    expect(reportedReach(object)).toBeGreaterThanOrEqual(object.radius);
  });

  it('Camille W sweep covers its cone range', () => {
    const object = new Camille_W_Object(owner);
    expect(reportedReach(object)).toBeGreaterThanOrEqual(object.range);
  });

  it('Ekko R chronobreak blast covers its blast radius', () => {
    const object = new Ekko_R_Object(owner);
    expect(reportedReach(object)).toBeGreaterThanOrEqual(object.radius);
  });

  it('Ekko W chronosphere covers its sphere radius', () => {
    const object = new Ekko_W_Object(owner);
    expect(reportedReach(object)).toBeGreaterThanOrEqual(object.radius);
  });

  it('Jarvan W golden aegis wave covers its full expansion', () => {
    const object = new JarvanIV_W_WaveObject(owner, 300);
    expect(reportedReach(object)).toBeGreaterThanOrEqual(object.maxRadius);
  });

  it('Jarvan E standard covers its drop path and its ground ring', () => {
    const object = new JarvanIV_E_Object(owner);
    const { x, y } = object.position;
    // deliberately not square: tall enough for the fall, wide enough for the ring
    expect(covers(object, x, y - JARVAN_E_DROP_HEIGHT)).toBe(true);
    expect(covers(object, x - 120, y)).toBe(true);
    expect(covers(object, x + 120, y)).toBe(true);
  });
});
