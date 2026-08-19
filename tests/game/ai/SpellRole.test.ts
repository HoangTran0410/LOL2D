import { describe, expect, it } from 'vitest';
import {
  SpellRole,
  ULTIMATE_SLOT,
  hasRole,
  inferRoles,
  roles,
  rolesOf,
  type InferenceInput,
} from '../../../src/game/ai/SpellRole';
import type { TargetingMode } from '../../../src/game/spell/runtime/types';
import type { TargetTeam } from '../../../src/game/spell/targeting/TargetResolver';
import type Spell from '../../../src/game/gameObject/Spell';

const input = (over: Partial<InferenceInput>): InferenceInput => ({
  targeting: 'POINT',
  range: 300,
  manaCost: 0,
  ...over,
});

/**
 * A spell-shaped object built from the real surface `rolesOf` reads:
 * `constructor`, `castSpec.targeting`, `manaCost`, `declaredRange`, and
 * `targetingRequest.targetTeam`. `castSpec` here carries only `targeting` —
 * the real `CastSpec` (`src/game/spell/runtime/types.ts`) has no `range` or
 * `targetTeam` field. An earlier version of this fixture bolted both onto
 * `castSpec`, which made the fixture pass while `rolesOf` read the real
 * (fieldless) `castSpec` and silently misclassified every untagged spell —
 * see the two "not a field bolted onto castSpec" regression tests below.
 */
const spellLike = (
  Ctor: Function,
  targeting: TargetingMode,
  opts: { manaCost?: number; declaredRange?: number; targetTeam?: TargetTeam } = {}
) =>
  Object.assign(Object.create(Ctor.prototype), {
    castSpec: { targeting },
    manaCost: opts.manaCost ?? 0,
    declaredRange: opts.declaredRange,
    targetingRequest: opts.targetTeam ? { targetTeam: opts.targetTeam } : {},
  }) as Spell;

describe('roles()', () => {
  it('combines flags into one mask', () => {
    const mask = roles(SpellRole.Damage, SpellRole.Dash);
    expect(hasRole(mask, SpellRole.Damage)).toBe(true);
    expect(hasRole(mask, SpellRole.Dash)).toBe(true);
    expect(hasRole(mask, SpellRole.Heal)).toBe(false);
  });

  it('is empty for no flags', () => {
    expect(roles()).toBe(SpellRole.None);
  });
});

describe('inferRoles()', () => {
  it('reads a free self-cast as a buff', () => {
    expect(inferRoles(input({ targeting: 'SELF', manaCost: 0 }))).toBe(SpellRole.Buff);
  });

  it('reads a paid self-cast as buff plus shield', () => {
    expect(inferRoles(input({ targeting: 'SELF', manaCost: 20 }))).toBe(
      roles(SpellRole.Buff, SpellRole.Shield)
    );
  });

  it('reads an ally-targeted spell as support', () => {
    const mask = inferRoles(input({ targeting: 'UNIT', targetTeam: 'ALLY', manaCost: 20 }));
    expect(hasRole(mask, SpellRole.Heal)).toBe(true);
    expect(hasRole(mask, SpellRole.Damage)).toBe(false);
  });

  it('reads a long-range skillshot as poke', () => {
    const mask = inferRoles(input({ targeting: 'DIRECTION', range: 600, manaCost: 10 }));
    expect(hasRole(mask, SpellRole.Poke)).toBe(true);
    expect(hasRole(mask, SpellRole.Damage)).toBe(true);
  });

  it('adds Burst once mana cost is high', () => {
    expect(hasRole(inferRoles(input({ range: 300, manaCost: 39 })), SpellRole.Burst)).toBe(false);
    expect(hasRole(inferRoles(input({ range: 300, manaCost: 40 })), SpellRole.Burst)).toBe(true);
  });

  it('never infers Dash — only a hand-written tag can say that', () => {
    for (const targeting of ['SELF', 'DIRECTION', 'POINT', 'UNIT'] as const) {
      expect(hasRole(inferRoles(input({ targeting, manaCost: 50 })), SpellRole.Dash)).toBe(false);
    }
  });
});

describe('rolesOf()', () => {
  it('prefers a hand-written static over inference', () => {
    class Tagged {
      static aiRoles = roles(SpellRole.Damage, SpellRole.Dash);
    }
    const mask = rolesOf(spellLike(Tagged, 'SELF'), 1);
    expect(hasRole(mask, SpellRole.Dash)).toBe(true);
    expect(hasRole(mask, SpellRole.Buff)).toBe(false);
  });

  it('falls back to inference when untagged', () => {
    class Untagged {}
    const mask = rolesOf(spellLike(Untagged, 'SELF'), 1);
    expect(hasRole(mask, SpellRole.Buff)).toBe(true);
  });

  it('adds Ultimate from the slot, not from the class', () => {
    class Any {}
    const inR = rolesOf(spellLike(Any, 'POINT', { declaredRange: 300 }), ULTIMATE_SLOT);
    const inQ = rolesOf(spellLike(Any, 'POINT', { declaredRange: 300 }), 1);
    expect(hasRole(inR, SpellRole.Ultimate)).toBe(true);
    expect(hasRole(inQ, SpellRole.Ultimate)).toBe(false);
  });

  it('does not let a slot-4 read poison the cached class mask', () => {
    class Shared {}
    rolesOf(spellLike(Shared, 'POINT', { declaredRange: 300 }), ULTIMATE_SLOT);
    const inW = rolesOf(spellLike(Shared, 'POINT', { declaredRange: 300 }), 2);
    expect(hasRole(inW, SpellRole.Ultimate)).toBe(false);
  });

  it('infers once per class, not once per instance', () => {
    class Counted {}
    // First instance would infer Buff (SELF, free).
    const first = rolesOf(spellLike(Counted, 'SELF', { manaCost: 0 }), 1);
    // Second instance of the SAME class whose castSpec would infer something
    // else entirely. If the mask were re-derived per instance this would come
    // back as a long-range poke; the cache means it comes back as the first
    // answer. Counting getter calls cannot test this — an object spread
    // evaluates a getter eagerly, so the counter moves before `rolesOf` runs.
    const second = rolesOf(spellLike(Counted, 'DIRECTION', { declaredRange: 600, manaCost: 0 }), 1);
    expect(second).toBe(first);
    expect(hasRole(second, SpellRole.Buff)).toBe(true);
    expect(hasRole(second, SpellRole.Poke)).toBe(false);
  });

  /**
   * Regression guard for a review finding on this task: `CastSpec` never
   * carries `range` or `targetTeam` (verified against
   * `src/game/spell/runtime/types.ts`), so `rolesOf` must source them from
   * `Spell.declaredRange` and `Spell.targetingRequest.targetTeam` — never by
   * reading fields off `castSpec` that only a synthetic test fixture has.
   * These two fail against a `rolesOf` that still reads `castSpec` for
   * either field, because `spellLike`'s `castSpec` here has neither.
   */
  it('classifies an ally heal from targetingRequest.targetTeam, not a field bolted onto castSpec', () => {
    class AllyHeal {}
    const mask = rolesOf(spellLike(AllyHeal, 'UNIT', { manaCost: 20, targetTeam: 'ALLY' }), 1);
    expect(hasRole(mask, SpellRole.Heal)).toBe(true);
    expect(hasRole(mask, SpellRole.Damage)).toBe(false);
  });

  it('classifies a long poke from declaredRange, not a field bolted onto castSpec', () => {
    class LongPoke {}
    const mask = rolesOf(spellLike(LongPoke, 'DIRECTION', { manaCost: 10, declaredRange: 600 }), 1);
    expect(hasRole(mask, SpellRole.Poke)).toBe(true);
  });
});
