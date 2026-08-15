import { afterEach, describe, expect, it, vi } from 'vitest';
import Nasus_Q, {
  BASE_DAMAGE,
  DAMAGE_PER_STACK,
} from '../../../src/game/gameObject/spells/Nasus_Q';
import Flash from '../../../src/game/gameObject/spells/Flash';
import Veigar_Q, { Veigar_Q_Power } from '../../../src/game/gameObject/spells/Veigar_Q';
import ChoGath_R, {
  ChoGath_R_Growth,
  MAX_HEALTH_PER_STACK,
} from '../../../src/game/gameObject/spells/ChoGath_R';
import { context } from '../practice/helpers';

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

/**
 * The buff-backed half. These two need a real unit — the count *is* how many
 * buff instances the unit is carrying — so they run on the practice bench's
 * `Champion` rather than a literal.
 */
afterEach(() => vi.unstubAllGlobals());

const veigarQ = () => {
  const { player } = context();
  const spell = new Veigar_Q(player);
  return { spell, owner: player };
};

const chogathR = () => {
  const { player } = context();
  const spell = new ChoGath_R(player);
  return { spell, owner: player };
};

const countBuffs = (owner: { buffs: { toRemove: boolean }[] }, Kind: unknown): number =>
  owner.buffs.filter(buff => buff instanceof (Kind as never) && !buff.toRemove).length;

describe('Veigar Q stacks', () => {
  it('reports the buff count, which nothing was feeding before', () => {
    const { spell } = veigarQ();
    expect(spell.stackCount).toBe(0);
  });

  it('raising adds that many buffs, configured the way a real hit configures them', () => {
    const { spell, owner } = veigarQ();
    spell.setStackCount(7);

    expect(countBuffs(owner, Veigar_Q_Power)).toBe(7);
    expect(spell.stackCount).toBe(7);
    // The whole point of the buff: max mana. A cheat that added seven inert
    // buffs would pass a count assertion and change nothing about the match.
    expect(owner.stats.maxMana.value).toBeGreaterThan(0);
  });

  it('lowering removes the extras and leaves the rest', () => {
    const { spell, owner } = veigarQ();
    spell.setStackCount(7);
    const manaAtSeven = owner.stats.maxMana.value;

    spell.setStackCount(2);

    expect(countBuffs(owner, Veigar_Q_Power)).toBe(2);
    expect(spell.stackCount).toBe(2);
    expect(owner.stats.maxMana.value).toBeLessThan(manaAtSeven);
  });
});

describe("Cho'Gath R stacks", () => {
  it('reports the buff count, which nothing was feeding before', () => {
    const { spell } = chogathR();
    expect(spell.stackCount).toBe(0);
  });

  it('raising adds that many buffs and that much max health', () => {
    const { spell, owner } = chogathR();
    const maxBefore = owner.stats.maxHealth.value;

    spell.setStackCount(4);

    expect(countBuffs(owner, ChoGath_R_Growth)).toBe(4);
    expect(spell.stackCount).toBe(4);
    expect(owner.stats.maxHealth.value).toBe(maxBefore + 4 * MAX_HEALTH_PER_STACK);
  });

  it("Cho'Gath R: raising stacks fills the new health, as a real stack does", () => {
    const { spell, owner } = chogathR();
    owner.stats.health.baseValue = 10;
    spell.setStackCount(4);
    // MAX_HEALTH_PER_STACK is 75 a stack, and onSpellCast heals it deliberately
    // — "the extra max health is only worth something if it comes filled in".
    expect(owner.stats.health.baseValue).toBeGreaterThan(10);
  });

  it("Cho'Gath R: lowering stacks does not heal, and does not leave health above max", () => {
    const { spell, owner } = chogathR();
    spell.setStackCount(10);
    const before = owner.stats.health.baseValue;
    spell.setStackCount(2);
    expect(owner.stats.health.baseValue).toBeLessThanOrEqual(owner.stats.maxHealth.value);
    expect(owner.stats.health.baseValue).toBeLessThanOrEqual(before);
  });
});
