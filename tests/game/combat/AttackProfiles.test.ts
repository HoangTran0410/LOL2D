import { beforeAll, describe, expect, it } from 'vitest';

import { ATTACK, spellGroups } from '../../../src/game/preset';
import { DEFAULT_CHAMPION_ATTACK } from '../../../src/game/gameObject/attackableUnits/Champion';
import { MELEE_RANGE_THRESHOLD } from '../../../src/game/combat/BasicAttack';
import { MAX_ATTACK_SPEED } from '../../../src/game/gameObject/Stats';
import { loadEverySpellForTests } from '../spell/registry';

// Spell classes arrive by dynamic import in the game (`spellRegistry.ts`);
// this fills the registry synchronously so a test can read the whole
// catalogue without awaiting 238 of them.
beforeAll(loadEverySpellForTests);

/**
 * Roles have to actually differ.
 *
 * Every champion in the game shared one profile — 16 damage at 0.8/s from 300
 * range — which made "marksman" a word in a description rather than anything
 * the game modelled, and left kits designed around attack speed with none.
 *
 * The failure mode this guards is not a typo, it is drift: someone retunes one
 * archetype toward another until the roster is uniform again and nothing looks
 * broken, because nothing is. So the assertions are about *gaps* and *ordering*,
 * not about the specific numbers, which are meant to be retuned freely.
 */
const dps = (a: { damage: number; attacksPerSecond: number }) => a.damage * a.attacksPerSecond;

describe('basic-attack profiles', () => {
  it('melee roles are actually under the melee threshold', () => {
    // 140 is what BasicAttackController reads to decide swing-vs-bolt. Every
    // champion sat at 300 before, so Garen and Malphite were firing projectiles.
    for (const role of ['ASSASSIN', 'BRUISER', 'TANK'] as const) {
      expect(ATTACK[role].range, role).toBeLessThan(MELEE_RANGE_THRESHOLD);
    }
    for (const role of ['MARKSMAN', 'MAGE', 'SUPPORT'] as const) {
      expect(ATTACK[role].range, role).toBeGreaterThan(MELEE_RANGE_THRESHOLD);
    }
  });

  it('reach is paid for in damage per swing', () => {
    // the cheapest melee swing still hits harder than the hardest ranged one
    const melee = Math.min(ATTACK.ASSASSIN.damage, ATTACK.BRUISER.damage, ATTACK.TANK.damage);
    const ranged = Math.max(ATTACK.MARKSMAN.damage, ATTACK.MAGE.damage, ATTACK.SUPPORT.damage);
    expect(melee).toBeGreaterThan(ranged);
  });

  it('the marksman swings fastest, which is the whole role', () => {
    for (const role of ['MAGE', 'SUPPORT', 'ASSASSIN', 'BRUISER', 'TANK'] as const) {
      expect(ATTACK.MARKSMAN.attacksPerSecond, role).toBeGreaterThan(ATTACK[role].attacksPerSecond);
    }
    // and far enough ahead that an attack-speed buff is worth building around
    expect(ATTACK.MARKSMAN.attacksPerSecond).toBeGreaterThan(ATTACK.TANK.attacksPerSecond * 1.5);
  });

  it('leaves headroom above the fastest base for buffs to matter', () => {
    // a marksman under one big attack-speed buff must not be sitting on the cap,
    // or a second source of attack speed buys nothing
    expect(ATTACK.MARKSMAN.attacksPerSecond * 1.45).toBeLessThan(MAX_ATTACK_SPEED);
  });

  it('no archetype is a rounding error away from the default', () => {
    // the default is the fallback for anything unassigned; an archetype that
    // matches it is not an archetype
    for (const [role, profile] of Object.entries(ATTACK)) {
      const same =
        profile.damage === DEFAULT_CHAMPION_ATTACK.damage &&
        profile.attacksPerSecond === DEFAULT_CHAMPION_ATTACK.attacksPerSecond &&
        profile.range === DEFAULT_CHAMPION_ATTACK.range;
      expect(same, role).toBe(false);
    }
  });

  it('every playable champion declares a profile', () => {
    // a champion left on the default is one that silently opted out of roles
    const unassigned: string[] = [];
    for (const group of spellGroups()) {
      // only champion shelves: these are the ones with a full four-spell kit
      if (!group.image?.startsWith('champ_')) continue;
      if (!group.attack) unassigned.push(group.name);
    }
    expect(unassigned).toEqual([]);
  });

  it('keeps every profile inside a sane dps band', () => {
    // wide on purpose: this catches a fat finger, not a balance opinion
    for (const [role, profile] of Object.entries(ATTACK)) {
      expect(dps(profile), role).toBeGreaterThan(8);
      expect(dps(profile), role).toBeLessThan(25);
    }
  });
});
