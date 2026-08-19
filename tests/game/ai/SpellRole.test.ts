import { describe, expect, it } from 'vitest';
import {
  SpellRole,
  ULTIMATE_SLOT,
  hasRole,
  inferRoles,
  roles,
  rolesOf,
} from '../../../src/game/ai/SpellRole';
import type { CastSpec } from '../../../src/game/spell/runtime/types';
import type Spell from '../../../src/game/gameObject/Spell';

const spec = (over: Partial<CastSpec>): Readonly<CastSpec> =>
  ({ targeting: 'POINT', range: 300, ...over }) as Readonly<CastSpec>;

/** A spell-shaped object: `rolesOf` only reads `constructor`, `castSpec`, `manaCost`. */
const spellLike = (Ctor: Function, castSpec: Readonly<CastSpec>, manaCost = 0) =>
  Object.assign(Object.create(Ctor.prototype), { castSpec, manaCost }) as Spell;

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
    expect(inferRoles(spec({ targeting: 'SELF' }), 0)).toBe(SpellRole.Buff);
  });

  it('reads a paid self-cast as buff plus shield', () => {
    expect(inferRoles(spec({ targeting: 'SELF' }), 20)).toBe(
      roles(SpellRole.Buff, SpellRole.Shield)
    );
  });

  it('reads an ally-targeted spell as support', () => {
    const mask = inferRoles(spec({ targeting: 'UNIT', targetTeam: 'ALLY' }), 20);
    expect(hasRole(mask, SpellRole.Heal)).toBe(true);
    expect(hasRole(mask, SpellRole.Damage)).toBe(false);
  });

  it('reads a long-range skillshot as poke', () => {
    const mask = inferRoles(spec({ targeting: 'DIRECTION', range: 600 }), 10);
    expect(hasRole(mask, SpellRole.Poke)).toBe(true);
    expect(hasRole(mask, SpellRole.Damage)).toBe(true);
  });

  it('adds Burst once mana cost is high', () => {
    expect(hasRole(inferRoles(spec({ range: 300 }), 39), SpellRole.Burst)).toBe(false);
    expect(hasRole(inferRoles(spec({ range: 300 }), 40), SpellRole.Burst)).toBe(true);
  });

  it('never infers Dash — only a hand-written tag can say that', () => {
    for (const targeting of ['SELF', 'DIRECTION', 'POINT', 'UNIT'] as const) {
      expect(hasRole(inferRoles(spec({ targeting }), 50), SpellRole.Dash)).toBe(false);
    }
  });
});

describe('rolesOf()', () => {
  it('prefers a hand-written static over inference', () => {
    class Tagged {
      static aiRoles = roles(SpellRole.Damage, SpellRole.Dash);
    }
    const mask = rolesOf(spellLike(Tagged, spec({ targeting: 'SELF' })), 1);
    expect(hasRole(mask, SpellRole.Dash)).toBe(true);
    expect(hasRole(mask, SpellRole.Buff)).toBe(false);
  });

  it('falls back to inference when untagged', () => {
    class Untagged {}
    const mask = rolesOf(spellLike(Untagged, spec({ targeting: 'SELF' })), 1);
    expect(hasRole(mask, SpellRole.Buff)).toBe(true);
  });

  it('adds Ultimate from the slot, not from the class', () => {
    class Any {}
    const inR = rolesOf(spellLike(Any, spec({})), ULTIMATE_SLOT);
    const inQ = rolesOf(spellLike(Any, spec({})), 1);
    expect(hasRole(inR, SpellRole.Ultimate)).toBe(true);
    expect(hasRole(inQ, SpellRole.Ultimate)).toBe(false);
  });

  it('does not let a slot-4 read poison the cached class mask', () => {
    class Shared {}
    rolesOf(spellLike(Shared, spec({})), ULTIMATE_SLOT);
    const inW = rolesOf(spellLike(Shared, spec({})), 2);
    expect(hasRole(inW, SpellRole.Ultimate)).toBe(false);
  });

  it('infers once per class, not once per instance', () => {
    class Counted {}
    // First instance would infer Buff (SELF, free).
    const first = rolesOf(spellLike(Counted, spec({ targeting: 'SELF' }), 0), 1);
    // Second instance of the SAME class whose castSpec would infer something
    // else entirely. If the mask were re-derived per instance this would come
    // back as a long-range poke; the cache means it comes back as the first
    // answer. Counting getter calls cannot test this — an object spread
    // evaluates a getter eagerly, so the counter moves before `rolesOf` runs.
    const second = rolesOf(spellLike(Counted, spec({ targeting: 'DIRECTION', range: 600 }), 0), 1);
    expect(second).toBe(first);
    expect(hasRole(second, SpellRole.Buff)).toBe(true);
    expect(hasRole(second, SpellRole.Poke)).toBe(false);
  });
});
