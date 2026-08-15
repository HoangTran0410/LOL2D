import { describe, expect, it } from 'vitest';
import Nasus_Q, {
  BASE_DAMAGE,
  DAMAGE_PER_STACK,
} from '../../../src/game/gameObject/spells/Nasus_Q';
import Flash from '../../../src/game/gameObject/spells/Flash';

/**
 * The write side of `Spell.stackCount`, which the Gian lận tab drives.
 *
 * Nasus keeps his count in a field on the spell; Veigar and Cho'Gath keep
 * theirs as N buff instances on the unit (see the second half of this file).
 * `setStackCount` is the one call that covers both, and it is absolute rather
 * than incremental so "give me 100" and "back to zero" are the same method.
 *
 * These first four need no owner at all — the catalogue already builds
 * ownerless spell instances (`hudInteractions.buildSpellItem`), and the stack
 * field and the description are the spell's own.
 */
const nasusQ = (): Nasus_Q => new Nasus_Q(null);

describe('Spell.setStackCount', () => {
  it('Nasus Q: setStackCount moves both the field and the reported count', () => {
    const spell = nasusQ();
    expect(spell.setStackCount(120)).toBe(true);
    expect(spell.stacks).toBe(120);
    expect(spell.stackCount).toBe(120);
  });

  it('Nasus Q: the tooltip states the damage the next strike will deal', () => {
    const spell = nasusQ();
    spell.setStackCount(10);
    // BASE_DAMAGE 25 + 10 * DAMAGE_PER_STACK 5 = 75, read from the spell's own
    // exported constants rather than restated.
    expect(spell.description).toContain(String(BASE_DAMAGE + 10 * DAMAGE_PER_STACK));
  });

  it('Nasus Q: refuses a negative count rather than storing one', () => {
    const spell = nasusQ();
    spell.setStackCount(5);
    spell.setStackCount(-3);
    expect(spell.stackCount).toBe(0);
  });

  it('a spell with no stacks refuses the call', () => {
    expect(new Flash(null).setStackCount(10)).toBe(false);
  });
});
