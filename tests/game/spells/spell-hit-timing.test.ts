import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: () => undefined,
    getAsset: () => undefined,
    renderable: () => undefined,
    ensure: async () => undefined,
  },
}));
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { BASE_DAMAGE } from '../../../packs/riot/spells/Cassiopeia_E';
import makeCassiopeia_E, { makeCassiopeia_E_Venom } from '../../../packs/riot/spells/Cassiopeia_E';
import { DAMAGE as CASS_R_DAMAGE } from '../../../packs/riot/spells/Cassiopeia_R';
import makeCassiopeia_R, { makeCassiopeia_R_Cone } from '../../../packs/riot/spells/Cassiopeia_R';
import { DAMAGE as LEE_DAMAGE } from '../../../packs/riot/spells/LeeSin_E';
import makeLeeSin_E, { makeLeeSin_E_Object } from '../../../packs/riot/spells/LeeSin_E';
import { DAMAGE as PANTHEON_DAMAGE } from '../../../packs/riot/spells/Pantheon_W';
import makePantheon_W from '../../../packs/riot/spells/Pantheon_W';
import { DAMAGE as SINGED_DAMAGE } from '../../../packs/riot/spells/Singed_E';
import makeSinged_E from '../../../packs/riot/spells/Singed_E';
const __api = buildContentApi();
const Cassiopeia_E = makeCassiopeia_E(__api);
const Cassiopeia_E_Venom = makeCassiopeia_E_Venom(__api);
const Cassiopeia_R = makeCassiopeia_R(__api);
const Cassiopeia_R_Cone = makeCassiopeia_R_Cone(__api);
const LeeSin_E = makeLeeSin_E(__api);
const LeeSin_E_Object = makeLeeSin_E_Object(__api);
const Pantheon_W = makePantheon_W(__api);
const Singed_E = makeSinged_E(__api);

/**
 * These six abilities all shipped the same bug: the damage and the crowd
 * control resolved on the frame of the cast, while the thing that was supposed
 * to *cause* them — a spit crossing 450px, a gaze sweeping a cone, a shockwave
 * expanding, a leap landing, a body being flung — played out afterwards as
 * decoration. A target could be stunned by a wave that had not left the
 * caster's feet, and could die to a projectile still in the air.
 *
 * The rule this suite holds: nothing lands on the cast frame, and something
 * further away is hit later than something close. Both halves matter — a fix
 * that simply delayed everything by a fixed time would pass the first and fail
 * the second.
 */
const at = (game: TestGame, x: number, y: number, team: string) => {
  const unit = createUnit(game, 0, team);
  unit.position.set(x, y);
  unit.stats.maxHealth.baseValue = 500;
  unit.stats.health.baseValue = 500;
  return unit;
};
const hp = (unit: AttackableUnit) => unit.stats.health.value;
const aimAt = (game: TestGame, x: number, y: number) => {
  (game as unknown as { worldMouse: unknown }).worldMouse = createVector(x, y);
};

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
});
afterEach(() => vi.unstubAllGlobals());

describe('the visual causes the hit', () => {
  it('Cassiopeia E: no damage until the spit arrives', () => {
    const game = createGame();
    const cass = at(game, 0, 0, 'blue');
    const victim = at(game, 300, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    new Cassiopeia_E(cass).onSpellCast();
    const spit = game.objectManager._objectToBeAdd.find(
      (o: unknown) => o instanceof Cassiopeia_E_Venom
    ) as Cassiopeia_E_Venom;
    expect(spit, 'a real missile exists').toBeTruthy();
    expect(hp(victim), 'nothing on the cast frame').toBe(500);

    let frames = 0;
    while (!spit.toRemove && frames++ < 200) spit.update();
    expect(frames, 'it took time to get there').toBeGreaterThan(5);
    expect(hp(victim)).toBe(500 - BASE_DAMAGE);
  });

  it('Cassiopeia R: the near target is petrified before the far one', () => {
    const game = createGame();
    const cass = at(game, 0, 0, 'blue');
    aimAt(game, 1000, 0);
    const near = at(game, 80, 0, 'red');
    const far = at(game, 400, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [near, far]) as never;

    new Cassiopeia_R(cass).onSpellCast();
    const cone = game.objectManager._objectToBeAdd.find(
      (o: unknown) => o instanceof Cassiopeia_R_Cone
    ) as Cassiopeia_R_Cone;
    expect(hp(near), 'nothing on the cast frame').toBe(500);

    vi.stubGlobal('deltaTime', 40);
    cone.update();
    cone.update();
    expect(hp(near), 'the wave has passed the near one').toBe(500 - CASS_R_DAMAGE);
    expect(hp(far), 'but not the far one yet').toBe(500);

    for (let i = 0; i < 20; i++) cone.update();
    expect(hp(far)).toBe(500 - CASS_R_DAMAGE);
    expect(far.buffs.some(b => b instanceof Stun)).toBe(true);
    // once only, however long it lives
    for (let i = 0; i < 20; i++) cone.update();
    expect(hp(far)).toBe(500 - CASS_R_DAMAGE);
  });

  it('Lee Sin E: the shockwave reaches the near target first', () => {
    const game = createGame();
    const lee = at(game, 0, 0, 'blue');
    const near = at(game, 30, 0, 'red');
    const far = at(game, 145, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [near, far]) as never;

    new LeeSin_E(lee).onSpellCast();
    const wave = game.objectManager._objectToBeAdd.find(
      (o: unknown) => o instanceof LeeSin_E_Object
    ) as LeeSin_E_Object;
    expect(hp(near)).toBe(500);

    vi.stubGlobal('deltaTime', 20);
    wave.update();
    expect(hp(near)).toBe(500 - LEE_DAMAGE);
    expect(hp(far), 'the front is still inside the far one').toBe(500);

    for (let i = 0; i < 20; i++) wave.update();
    expect(hp(far)).toBe(500 - LEE_DAMAGE);
    for (let i = 0; i < 40; i++) wave.update();
    expect(hp(far), 'hit once').toBe(500 - LEE_DAMAGE);
  });

  it('Pantheon W: the stun waits for the landing', () => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    const victim = at(game, 300, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    // The vault takes whoever is nearest the *cursor*, so a cast needs one:
    // `aimPoint` falls back to the live mouse when there is no cast context.
    (game as unknown as { worldMouse: unknown }).worldMouse = victim.position.copy();

    new Pantheon_W(pantheon).onSpellCast();
    expect(hp(victim), 'still airborne').toBe(500);
    expect(victim.buffs.some(b => b instanceof Stun)).toBe(false);

    const dash = pantheon.buffs.find(b => b instanceof Dash) as Dash;
    let frames = 0;
    while (!dash.toRemove && frames++ < 200) dash.update();
    expect(frames).toBeGreaterThan(5);
    expect(hp(victim)).toBe(500 - PANTHEON_DAMAGE);
    expect(victim.buffs.some(b => b instanceof Stun)).toBe(true);
  });

  it('Pantheon W: the leap follows a target that keeps walking', () => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    const victim = at(game, 300, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    // The vault takes whoever is nearest the *cursor*, so a cast needs one:
    // `aimPoint` falls back to the live mouse when there is no cast context.
    (game as unknown as { worldMouse: unknown }).worldMouse = victim.position.copy();

    new Pantheon_W(pantheon).onSpellCast();
    const dash = pantheon.buffs.find(b => b instanceof Dash) as Dash;
    let frames = 0;
    while (!dash.toRemove && frames++ < 200) {
      // Running, not strolling: 14px a frame leaves a fixed destination 180px
      // behind by the time he lands, well outside STRIKE_RADIUS.
      victim.position.set(victim.position.x, victim.position.y + 14);
      dash.update();
    }
    // Waiting for the landing must not turn a lock-on ability into a coin flip.
    expect(hp(victim)).toBe(500 - PANTHEON_DAMAGE);
  });

  it('Pantheon W: a leap that never arrives does not stun', () => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    const victim = at(game, 300, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    // The vault takes whoever is nearest the *cursor*, so a cast needs one:
    // `aimPoint` falls back to the live mouse when there is no cast context.
    (game as unknown as { worldMouse: unknown }).worldMouse = victim.position.copy();

    new Pantheon_W(pantheon).onSpellCast();
    const dash = pantheon.buffs.find(b => b instanceof Dash) as Dash;
    dash.update();
    victim.position.set(2000, 2000); // they ran
    dash.deactivateBuff();

    expect(hp(victim)).toBe(500);
    expect(victim.buffs.some(b => b instanceof Stun)).toBe(false);
  });

  it('Singed E: the damage lands with the body', () => {
    const game = createGame();
    const singed = at(game, 0, 0, 'blue');
    const victim = at(game, 120, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    new Singed_E(singed).onSpellCast();
    expect(hp(victim), 'still in the air').toBe(500);

    const dash = victim.buffs.find(b => b instanceof Dash) as Dash;
    let frames = 0;
    while (!dash.toRemove && frames++ < 200) dash.update();
    expect(frames).toBeGreaterThan(5);
    expect(hp(victim)).toBe(500 - SINGED_DAMAGE);
  });
});
