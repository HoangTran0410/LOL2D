import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));
import Champion from '../../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../../src/game/gameObject/attackableUnits/Minion';
import Dash from '../../../../src/game/gameObject/buffs/Dash';
import Slow from '../../../../src/game/gameObject/buffs/Slow';
import StatusFlags from '../../../../src/game/enums/StatusFlags';
import type AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import makePantheon_W from '../../../../packs/riot/spells/Pantheon_W';
import { DURATION as E_DURATION, HALF_ANGLE, REACH } from '../../../../packs/riot/spells/Pantheon_E';
import makePantheon_E, { makePantheon_E_Aegis, makePantheon_E_Object } from '../../../../packs/riot/spells/Pantheon_E';
import { DAMAGE as R_DAMAGE, FALL_MS, FLIGHT_MS, LAUNCH_MS, MAX_RANGE, SKY_HEIGHT } from '../../../../packs/riot/spells/Pantheon_R';
import makePantheon_R, { makePantheon_R_Meteor, makePantheon_R_Object, makePantheon_R_Skyward } from '../../../../packs/riot/spells/Pantheon_R';
const __api = buildContentApi();
const Pantheon_W = makePantheon_W(__api);
const Pantheon_E = makePantheon_E(__api);
const Pantheon_E_Aegis = makePantheon_E_Aegis(__api);
const Pantheon_E_Object = makePantheon_E_Object(__api);
const Pantheon_R = makePantheon_R(__api);
const Pantheon_R_Meteor = makePantheon_R_Meteor(__api);
const Pantheon_R_Object = makePantheon_R_Object(__api);
const Pantheon_R_Skyward = makePantheon_R_Skyward(__api);

const at = (game: TestGame, x: number, y: number, teamId: string): AttackableUnit => {
  const unit = createUnit(game, x, teamId);
  unit.position.set(x, y);
  return unit;
};

const aimAt = (game: TestGame, target: { x: number; y: number }) => {
  (game as unknown as { worldMouse: unknown }).worldMouse = createVector(target.x, target.y);
};

const find = <T>(game: TestGame, Kind: new (...args: never[]) => T): T | undefined =>
  (game.objectManager as unknown as { _objectToBeAdd: unknown[] })._objectToBeAdd.find(
    (object): object is T => object instanceof Kind
  );

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
});
afterEach(() => vi.unstubAllGlobals());

/**
 * The vault used to take whoever stood closest to *Pantheon*, which made a
 * gap-closer unaimable: in any lane fight the front minion is nearer than the
 * champion behind it, so the ability spent itself on the wrong body every time
 * and the player had no say in it.
 */
describe('Pantheon W leaps at the enemy nearest the cursor', () => {
  const twoEnemies = () => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    const near = at(game, 120, 0, 'red');
    const far = at(game, 340, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [near, far]) as never;
    return { game, pantheon, near, far };
  };

  it('picks the far enemy when the cursor is on it, not the one under his feet', () => {
    const { game, pantheon, far } = twoEnemies();
    aimAt(game, { x: 360, y: 30 });

    expect(new Pantheon_W(pantheon)._findTarget()).toBe(far);

    new Pantheon_W(pantheon).onSpellCast();
    const dash = pantheon.buffs.find(buff => buff instanceof Dash) as Dash;
    // The leap stops 40px short of the body it is aimed at.
    expect(dash.dashDestination!.x).toBeCloseTo(300, 0);
  });

  it('still picks the near one when the cursor is on the near one', () => {
    const { game, pantheon, near } = twoEnemies();
    aimAt(game, { x: 110, y: -20 });

    expect(new Pantheon_W(pantheon)._findTarget()).toBe(near);
  });

  it('never reaches past its own range, however far away the cursor is', () => {
    const { game, pantheon } = twoEnemies();
    // Only bodies the range query returns are candidates; the cursor breaks the
    // tie between them and is not itself a destination.
    game.objectManager.queryObjects = vi.fn(() => []) as never;
    aimAt(game, { x: 5000, y: 5000 });

    expect(new Pantheon_W(pantheon)._findTarget()).toBeNull();
    expect(new Pantheon_W(pantheon).checkCastCondition()).toBe(false);
  });
});

/**
 * E is two objects on two layers: the dirt he tears up has to paint under the
 * feet standing in it, and the shield he is holding has to paint over them.
 */
describe('Pantheon E plants a shield over a wedge of torn ground', () => {
  const cast = () => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    aimAt(game, { x: 300, y: 0 });
    game.objectManager.queryObjects = vi.fn(() => []) as never;
    new Pantheon_E(pantheon).onSpellCast();
    return {
      game,
      pantheon,
      ground: find(game, Pantheon_E_Object)!,
      aegis: find(game, Pantheon_E_Aegis)!,
    };
  };

  it('paints the wedge under the units and the aegis over them', () => {
    const { ground, aegis } = cast();

    expect(ground.zIndex).not.toBeNull();
    expect(ground.zIndex!).toBeLessThan(Champion.displayZIndex);
    expect(ground.zIndex!).toBeLessThan(Minion.displayZIndex);
    // The shield is held up in front of him; it is not a stain on the floor.
    expect(aegis.zIndex ?? 99).toBeGreaterThan(Champion.displayZIndex);
  });

  it('kills the shield with the wedge rather than leaving it hanging', () => {
    const { ground, aegis } = cast();

    ground.onRemoved();
    expect(aegis.toRemove).toBe(true);
  });

  it('damages exactly the wedge it draws', () => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    aimAt(game, { x: 300, y: 0 });
    // One body just inside the painted edge, one just outside it.
    const inside = at(
      game,
      Math.cos(HALF_ANGLE - 0.05) * 120,
      Math.sin(HALF_ANGLE - 0.05) * 120,
      'red'
    );
    const outside = at(
      game,
      Math.cos(HALF_ANGLE + 0.05) * 120,
      Math.sin(HALF_ANGLE + 0.05) * 120,
      'red'
    );
    game.objectManager.queryObjects = vi.fn(() => [inside, outside]) as never;

    new Pantheon_E(pantheon).onSpellCast();
    const ground = find(game, Pantheon_E_Object)!;
    const full = inside.stats.maxHealth.value;

    vi.stubGlobal('deltaTime', 500); // past one tick interval
    ground.update();

    expect(inside.stats.health.value).toBeLessThan(full);
    expect(outside.stats.health.value).toBe(full);
  });

  it('reaches as far as it says it does', () => {
    const { ground } = cast();
    const box = ground.getDisplayBoundingBox();

    expect(box.w).toBeGreaterThanOrEqual(REACH * 2);
    expect(ground.lifeTime).toBe(E_DURATION);
  });
});

/**
 * "Trời Sập": he leaves the map, is untouchable while he is gone, and comes back
 * down as the projectile. The old version threw a spear and never moved him.
 */
describe('Pantheon R throws Pantheon, not a spear', () => {
  const cast = (landingX = 600) => {
    const game = createGame();
    const pantheon = at(game, 0, 0, 'blue');
    const victim = at(game, landingX, 0, 'red');
    aimAt(game, { x: landingX, y: 0 });
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    new Pantheon_R(pantheon).onSpellCast();
    return {
      game,
      pantheon,
      victim,
      flight: find(game, Pantheon_R_Object)!,
      meteor: find(game, Pantheon_R_Meteor)!,
    };
  };

  it('takes him off the map: untargetable, and unable to act from up there', () => {
    const { pantheon } = cast();

    const skyward = pantheon.buffs.find(
      buff => buff instanceof Pantheon_R_Skyward
    ) as Pantheon_R_Skyward;
    expect(skyward, 'the flight is a buff, so it survives being off screen').toBeTruthy();
    expect(skyward.statusFlagsToDisable & StatusFlags.Targetable).toBeTruthy();
    // A champion in orbit must not be able to walk or cast — `Stunned` is what
    // actually clears CAN_MOVE/CAN_CAST, see buffs/Stasis.ts.
    expect(skyward.statusFlagsToEnable & StatusFlags.Stunned).toBeTruthy();
    // ...and terrain has no business grabbing a body 700px above it.
    expect(skyward.statusFlagsToEnable & StatusFlags.Ghosted).toBeTruthy();
  });

  it('hurts nobody at cast time, and nobody while he is still climbing', () => {
    const { flight, victim, pantheon } = cast();
    const full = victim.stats.maxHealth.value;

    expect(victim.stats.health.value).toBe(full);
    expect(flight.landed).toBe(false);

    vi.stubGlobal('deltaTime', LAUNCH_MS - 20);
    flight.update();

    expect(victim.stats.health.value, 'still on the way up').toBe(full);
    expect(pantheon.position.x, 'the climb is straight up, so he has not moved').toBeCloseTo(0, 0);
    expect(flight.altitude).toBeGreaterThan(0);
  });

  it('carries him across the sky so the camera is looking at the landing', () => {
    const { flight, pantheon } = cast();

    vi.stubGlobal('deltaTime', LAUNCH_MS + FALL_MS / 2);
    flight.update();

    // Halfway through the fall he is halfway across, and high up.
    expect(pantheon.position.x).toBeGreaterThan(100);
    expect(pantheon.position.x).toBeLessThan(600);
    expect(flight.altitude).toBeGreaterThan(0);
  });

  it('lands in the circle, once, dealing the damage and the slow there', () => {
    const { flight, pantheon, victim } = cast();
    const full = victim.stats.maxHealth.value;

    vi.stubGlobal('deltaTime', FLIGHT_MS + 10);
    flight.update();

    expect(flight.landed).toBe(true);
    expect(victim.stats.health.value).toBe(full - R_DAMAGE);
    expect(victim.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(pantheon.position.x).toBeCloseTo(600, 0);
    expect(
      pantheon.buffs.some(buff => buff instanceof Pantheon_R_Skyward && !buff.toRemove),
      'back on the map means targetable again'
    ).toBe(false);

    // Death, scene exit and a normal landing all converge on `land`.
    flight.onRemoved();
    flight.update();
    expect(victim.stats.health.value).toBe(full - R_DAMAGE);
  });

  it('cannot be aimed past its own range', () => {
    const { flight } = cast(5000);

    expect(flight.landing.x).toBeCloseTo(MAX_RANGE, 0);
  });

  it('draws the ground under the units and the meteor above them', () => {
    const { flight, meteor } = cast();

    expect(flight.zIndex!).toBeLessThan(Champion.displayZIndex);
    expect(meteor.zIndex ?? 99).toBeGreaterThan(Champion.displayZIndex);

    // The meteor is painted a long way above the ground plane, but the object
    // manager culls on ground coordinates — a box around its centre would pop
    // it out of existence while it is still plainly on screen.
    const box = meteor.getDisplayBoundingBox();
    expect(box.y).toBeLessThanOrEqual(meteor.position.y - SKY_HEIGHT);
  });

  it('does not leave a meteor in the sky when the flight ends', () => {
    const { flight, meteor } = cast();

    vi.stubGlobal('deltaTime', FLIGHT_MS + 10);
    flight.update();

    expect(meteor.toRemove).toBe(true);
  });
});
