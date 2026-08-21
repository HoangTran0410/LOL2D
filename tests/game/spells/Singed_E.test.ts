import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Airborne from '../../../src/game/gameObject/buffs/Airborne';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { THROW_DISTANCE } from '../../../packs/riot/spells/Singed_E';
import makeSinged_E from '../../../packs/riot/spells/Singed_E';
const __api = buildContentApi();
const Singed_E = makeSinged_E(__api);

installSpellObjectGlobals();

/**
 * A fling puts the victim on the *other* side of the caster. The first version
 * pushed along `caster -> victim` instead, which leaves them exactly where
 * they were relative to Singed and only further away — a shove, and the
 * opposite of what the ability is for.
 */
describe('Singed E throws the victim behind him', () => {
  it('lands them on the far side of Singed, not further out', () => {
    const game = createGame();
    const singed = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 120, 'red'); // due east of Singed
    // The lookup is Nasus Q's, already covered; this test is about where the
    // victim ends up, so hand the spell its target directly.
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    const spell = new Singed_E(singed);
    spell.onSpellCast();

    const dash = victim.buffs.find(buff => buff instanceof Dash) as Dash | undefined;
    expect(dash, 'the victim is dashed, not teleported').toBeTruthy();

    const landing = dash!.dashDestination!;
    // Due west of Singed: the sign of x flips, which is the whole fix.
    expect(landing.x).toBeCloseTo(-THROW_DISTANCE, 3);
    expect(landing.y).toBeCloseTo(0, 3);
    // ...and measured from Singed's feet, not from where the victim stood.
    expect(singed.position.dist(landing)).toBeCloseTo(THROW_DISTANCE, 3);

    expect(victim.buffs.some(buff => buff instanceof Airborne)).toBe(true);
    // Singed's own knock-up must not abort Singed's own displacement.
    expect(dash!.cancelable).toBe(false);
  });
});
