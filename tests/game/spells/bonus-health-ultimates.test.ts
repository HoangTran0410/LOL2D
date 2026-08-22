/**
 * The three "grow bigger and tankier" ultimates — Singed R, Nasus R and
 * Renekton R — each raise max health and top the champion up by the same
 * amount. They expressed the top-up as `health: { baseBonus: N }` on their
 * StatAmp, and because `Stats.update()` wrote its regeneration back from
 * `health.value` rather than `health.baseValue`, that bonus was folded into the
 * base and re-applied every single frame: +N per frame, ~3000 health a second
 * at 60fps, which re-pinned the caster to full health faster than anything
 * could damage them. It was reported as "Singed feels immortal".
 *
 * The fill is a heal now, so this asserts the property that was violated: the
 * grant happens **once**, and the champion keeps taking damage normally for the
 * rest of the duration.
 *
 * The `stat-resource-modifier` seam bans the pattern statically; this checks the
 * behaviour, because the static ban would still pass if a future edit swapped
 * the modifier for some other per-frame grant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { BONUS_HEALTH as SINGED_BONUS } from '../../../packs/riot/spells/Singed_R';
import makeSinged_R from '../../../packs/riot/spells/Singed_R';
import { BONUS_HEALTH as NASUS_BONUS } from '../../../packs/riot/spells/Nasus_R';
import makeNasus_R from '../../../packs/riot/spells/Nasus_R';
import { BONUS_HEALTH as RENEKTON_BONUS } from '../../../packs/riot/spells/Renekton_R';
import makeRenekton_R from '../../../packs/riot/spells/Renekton_R';
const __api = buildContentApi();
const Singed_R = makeSinged_R(__api);
const Nasus_R = makeNasus_R(__api);
const Renekton_R = makeRenekton_R(__api);

const champion = (game: TestGame): AttackableUnit => {
  const unit = new Champion({ game, teamId: 'blue' } as never) as unknown as AttackableUnit;
  unit.position.set(1_000, 1_000);
  return unit;
};

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
});
afterEach(() => vi.unstubAllGlobals());

const ULTIMATES = [
  ['Singed R', (owner: AttackableUnit) => new Singed_R(owner as never), SINGED_BONUS],
  ['Nasus R', (owner: AttackableUnit) => new Nasus_R(owner as never), NASUS_BONUS],
  ['Renekton R', (owner: AttackableUnit) => new Renekton_R(owner as never), RENEKTON_BONUS],
] as const;

describe.each(ULTIMATES)('%s', (_name, build, bonus) => {
  it('grants its bonus health exactly once, not once per frame', () => {
    const game = createGame();
    const caster = champion(game);

    // Hurt first, so there is room for the heal and room to see it repeat.
    const startingMax = caster.stats.maxHealth.value;
    caster.stats.health.baseValue = startingMax / 2;
    const beforeCast = caster.stats.health.baseValue;
    caster.stats.healthRegen.baseValue = 0;

    build(caster).onSpellCast({} as never);

    const afterCast = caster.stats.health.baseValue;
    expect(afterCast).toBe(beforeCast + bonus);
    expect(caster.stats.maxHealth.value).toBe(startingMax + bonus);

    // Ten frames of nothing happening must not move the pool at all. Before the
    // fix this reached the (raised) maximum within a handful of frames.
    for (let frame = 0; frame < 10; frame++) caster.stats.update();
    expect(caster.stats.health.baseValue).toBe(afterCast);
  });

  it('leaves the champion damageable for the whole duration', () => {
    const game = createGame();
    const caster = champion(game);
    caster.stats.healthRegen.baseValue = 0;

    build(caster).onSpellCast({} as never);
    const afterCast = caster.stats.health.baseValue;

    // Damage interleaved with frames, the way a real fight arrives.
    for (let frame = 0; frame < 10; frame++) {
      caster.takeDamage(5);
      caster.stats.update();
    }

    expect(caster.stats.health.baseValue).toBe(afterCast - 50);
  });
});
