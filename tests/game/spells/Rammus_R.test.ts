import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Untargetable from '../../../src/game/gameObject/buffs/Untargetable';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { RADIUS } from '../../../packs/riot/spells/Rammus_R';
import makeRammus_R, { makeRammus_R_Leap } from '../../../packs/riot/spells/Rammus_R';
const __api = buildContentApi();
const Rammus_R = makeRammus_R(__api);
const Rammus_R_Leap = makeRammus_R_Leap(__api);

installSpellObjectGlobals();

/**
 * The ability is the flight. It used to write `owner.position` and blast in the
 * same frame — a teleport, with no airtime for the victims to walk out of the
 * circle and no window where Rammus was actually in the air.
 */
describe('Rammus R leaps instead of teleporting', () => {
  const cast = () => {
    const game = createGame();
    const rammus = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 400, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    const spell = new Rammus_R(rammus);
    // `aimPoint` reads the cast context's cursor, or the live mouse when there
    // is none — `onSpellCast` is driven here directly, so supply the mouse.
    (game as unknown as { worldMouse: unknown }).worldMouse = victim.position.copy();
    spell.onSpellCast();
    const leap = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Rammus_R_Leap => object instanceof Rammus_R_Leap
    );
    return { game, rammus, victim, leap };
  };

  it('does not move Rammus or damage anyone at cast time', () => {
    const { rammus, victim, leap } = cast();

    expect(rammus.position.x).toBe(0); // still standing where he pressed it
    expect(victim.stats.health.value).toBe(victim.stats.maxHealth.value);
    expect(leap, 'the leap owns the landing').toBeTruthy();
    expect(leap!.landed).toBe(false);
  });

  it('spends the flight untargetable, on a dash it cannot lose', () => {
    const { rammus } = cast();

    const dash = rammus.buffs.find(buff => buff instanceof Dash) as Dash | undefined;
    expect(dash).toBeTruthy();
    expect(dash!.dashDestination).toBeTruthy();
    // His own knock-up lands on the victims, not on him, but a stray one must
    // not drop him out of the sky mid-jump either.
    expect(dash!.cancelable).toBe(false);
    expect(rammus.buffs.some(buff => buff instanceof Untargetable)).toBe(true);
  });

  it('slams exactly once, on arrival, and drops the untargetable window with it', () => {
    const { rammus, victim, leap } = cast();
    const full = victim.stats.maxHealth.value;

    rammus.position.set(400, 0); // the dash has carried him in
    leap!.update();
    const afterLanding = victim.stats.health.value;

    expect(afterLanding).toBeLessThan(full);
    expect(leap!.toRemove).toBe(true);
    expect(rammus.buffs.some(buff => buff instanceof Untargetable && !buff.toRemove)).toBe(false);

    // Death, scene exit and a normal landing all converge on `land`.
    leap!.onRemoved();
    leap!.update();
    expect(victim.stats.health.value).toBe(afterLanding);
  });

  it('lands anyway if the dash never arrives, rather than hanging in the air', () => {
    const { victim, leap } = cast();

    vi.stubGlobal('deltaTime', 5000); // well past LEAP_TIMEOUT_MS
    leap!.update();
    vi.stubGlobal('deltaTime', 16);

    expect(leap!.landed).toBe(true);
    expect(victim.stats.health.value).toBeLessThan(victim.stats.maxHealth.value);
    expect(leap!.radius).toBe(RADIUS);
  });
});
