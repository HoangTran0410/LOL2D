import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { DUSK_GRACE_MS, SPEED_PERCENT, TRAIL_MS, TRAIL_RADIUS } from '../../../packs/riot/spells/Nocturne_Q';
import makeNocturne_Q, { makeNocturne_Dusk, makeNocturne_Q_Object, makeNocturne_Q_Trail } from '../../../packs/riot/spells/Nocturne_Q';
const __api = buildContentApi();
const Nocturne_Q = makeNocturne_Q(__api);
const Nocturne_Dusk = makeNocturne_Dusk(__api);
const Nocturne_Q_Object = makeNocturne_Q_Object(__api);
const Nocturne_Q_Trail = makeNocturne_Q_Trail(__api);

installSpellObjectGlobals();

const cast = () => {
  const game = createGame();
  const nocturne = createUnit(game, 0, 'blue');
  (game as unknown as { worldMouse: unknown }).worldMouse = createVector(600, 0);
  game.objectManager.queryObjects = vi.fn(() => []) as never;

  new Nocturne_Q(nocturne).onSpellCast();
  const pending = game.objectManager._objectToBeAdd;
  let blade: Nocturne_Q_Object | undefined;
  let trail: Nocturne_Q_Trail | undefined;
  for (const object of pending) {
    if (object instanceof Nocturne_Q_Object) blade = object;
    if (object instanceof Nocturne_Q_Trail) trail = object;
  }
  return { game, nocturne, blade: blade!, trail: trail! };
};

const onTrail = (unit: { buffs: unknown[] }) =>
  (unit.buffs as { toRemove: boolean }[]).some(
    buff => buff instanceof Nocturne_Dusk && !buff.toRemove
  );

/**
 * The wiki is explicit: the blade *leaves a Dusk Trail*, and Nocturne gets his
 * speed **while on it**. The first version applied a flat `Speedup` at cast
 * time and drew no trail at all — a different ability wearing the same
 * tooltip.
 */
describe('Nocturne Q lays a trail and pays for standing on it', () => {
  it('grants nothing at cast time', () => {
    const { nocturne } = cast();

    expect(onTrail(nocturne), 'the buff is the trail’s to give').toBe(false);
  });

  it('paints the ground behind the blade as it flies', () => {
    const { blade, trail } = cast();

    expect(trail.patches).toHaveLength(0);
    for (let i = 0; i < 30; i++) {
      blade.update();
      trail.update();
    }

    expect(trail.patches.length).toBeGreaterThan(3);
    // Laid along the flight path, east of the caster.
    expect(trail.patches[trail.patches.length - 1].x).toBeGreaterThan(trail.patches[0].x);
  });

  it('buffs Nocturne only while his body is over a patch', () => {
    const { nocturne, blade, trail } = cast();
    for (let i = 0; i < 30; i++) {
      blade.update();
      trail.update();
    }
    const patch = trail.patches[trail.patches.length - 1];

    nocturne.position.set(patch.x, patch.y);
    trail.update();
    expect(trail.ownerIsOnTrail).toBe(true);
    expect(onTrail(nocturne), 'standing on it').toBe(true);

    const dusk = nocturne.buffs.find(buff => buff instanceof Nocturne_Dusk) as Nocturne_Dusk;
    expect(dusk.duration).toBe(DUSK_GRACE_MS);
    expect(dusk.statsModifier.speed.percentBaseBonus).toBeCloseTo(SPEED_PERCENT, 5);
    expect(dusk.statsModifier.attackDamage.baseBonus).toBeGreaterThan(0);

    // Step off. The predicate goes false at once; the buff follows it out
    // after the grace window, which is the point of the window — stepping
    // between two patches must not flicker it.
    nocturne.position.set(patch.x + TRAIL_RADIUS + 200, patch.y);
    trail.update();
    expect(trail.ownerIsOnTrail, 'off the trail').toBe(false);
    expect(onTrail(nocturne), 'still inside the grace window').toBe(true);

    vi.stubGlobal('deltaTime', DUSK_GRACE_MS + 50);
    nocturne.update();
    vi.stubGlobal('deltaTime', 16);
    expect(onTrail(nocturne), 'grace expired').toBe(false);
  });

  it('an enemy champion it hits paints a trail of their own', () => {
    const { game, blade } = cast();
    const victim = createUnit(game, 200, 'red');

    blade.onHit(victim);

    const painted: Nocturne_Q_Trail[] = [];
    for (const object of game.objectManager._objectToBeAdd) {
      if (object instanceof Nocturne_Q_Trail && object.source === victim) painted.push(object);
    }
    expect(painted, 'the victim becomes a source').toHaveLength(1);
    expect(painted[0].sourceLifeMs).toBe(TRAIL_MS);
  });

  it('outlives the blade, then ages out patch by patch', () => {
    const { blade, trail } = cast();
    for (let i = 0; i < 30; i++) {
      blade.update();
      trail.update();
    }
    blade.toRemove = true;
    trail.update();

    expect(trail.source, 'the painter is gone').toBeNull();
    expect(trail.patches.length, 'the ground is not').toBeGreaterThan(0);
    expect(trail.toRemove).toBe(false);

    vi.stubGlobal('deltaTime', TRAIL_MS + 100);
    trail.update();
    vi.stubGlobal('deltaTime', 16);

    expect(trail.patches).toHaveLength(0);
    expect(trail.toRemove).toBe(true);
  });
});
