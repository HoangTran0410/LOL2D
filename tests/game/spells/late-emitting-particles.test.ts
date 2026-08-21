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
import { makeJarvanIV_E_Object } from '../../../packs/riot/spells/JarvanIV_E';
import { makeCamille_W_Object } from '../../../packs/riot/spells/Camille_W';
import { makeEkko_W_Object } from '../../../packs/riot/spells/Ekko_W';
const __api = buildContentApi();
const JarvanIV_E_Object = makeJarvanIV_E_Object(__api);
const Camille_W_Object = makeCamille_W_Object(__api);
const Ekko_W_Object = makeEkko_W_Object(__api);

/**
 * `ParticleSystem.autoRemoveIfEmpty` defaults to true, and `update()` applies it
 * on the very first frame. So a system registered by an effect that does not
 * emit *until later* — Jarvan's standard, which only throws dust when the pole
 * touches down ~180ms after it is created; Camille's sweep, which emits on the
 * strike at 200ms; Ekko's sphere, which emits when it arms at 2000ms — deletes
 * itself long before its own emit point, and the impact it exists for never
 * appears. Nothing errors and the spell still works, so it is invisible except
 * by looking.
 *
 * The effect owns the system for as long as it owns itself.
 */
describe('a spell keeps its particle system alive until it has emitted', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    owner = createUnit(game, 0, 'blue');
    owner.stats.size.baseValue = 20;
    game.setPlayer(owner);
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Advances the effect and its particle system together, as the world does. */
  function run(effect: any, frames: number) {
    for (let i = 0; i < frames; i++) {
      effect.update();
      effect.particleSystem.update();
    }
  }

  it('Jarvan E still has a system to throw landing dust into', () => {
    const flag = new JarvanIV_E_Object(owner);
    flag.position.set(0, 0);
    flag.onAdded();

    // the pole is still in the air here, and the system has emitted nothing
    run(flag, 4);
    expect(flag.particleSystem.toRemove).toBe(false);

    // now let it land, and the dust must actually go somewhere
    run(flag, 20);
    expect(flag.hasLanded).toBe(true);
    expect(flag.particleSystem.particles.length).toBeGreaterThan(0);
  });

  it('Camille W still has a system when the sweep strikes', () => {
    const sweep = new Camille_W_Object(owner);
    sweep.position.set(0, 0);
    sweep.onAdded();

    run(sweep, 4); // before the 200ms strike
    expect(sweep.particleSystem.toRemove).toBe(false);

    run(sweep, 12);
    expect(sweep.hasStruck).toBe(true);
    expect(sweep.particleSystem.particles.length).toBeGreaterThan(0);
  });

  it('Ekko W still has a system two seconds later when the sphere arms', () => {
    const sphere = new Ekko_W_Object(owner);
    sphere.position.set(500, 500); // away from Ekko, so it does not detonate
    sphere.onAdded();

    run(sphere, 10);
    expect(sphere.particleSystem.toRemove).toBe(false);
  });
});
