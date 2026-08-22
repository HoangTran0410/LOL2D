/**
 * URF (`matchRules.manaFree`) is meant to be a single flip, not a per-spell
 * edit: `Spell.effectiveMana()` states the rule once and `Spell.spendMana()`
 * is the only sanctioned way for a spell to bill its caster. Anivia R used to
 * drain `owner.stats.mana.baseValue` against a raw module constant, so the
 * storm kept charging — and kept shutting itself off at low mana — with URF
 * on. Nothing in `tsc` catches that: the write is perfectly well typed.
 *
 * So this is a static source scan, in the shape of
 * tests/game/spells/cc-buff-icons.test.ts: it fails on the *pattern* rather
 * than on any one spell's behaviour, which is what keeps the mistake from
 * coming back in the next spell someone writes.
 *
 * Scope is the spell-authored side of the game object tree — `spells/`,
 * `spellObjects/`, `buffs/`. Unit-side mana plumbing is deliberately out of
 * scope and was checked by hand: `structures/Fountain.ts` restores mana,
 * `Stats.ts` clamps it to the maximum, `MatchDirector.ts` refills it and
 * `attackableUnits/Champion.ts` reads it to draw the bar. None of those is a
 * spell billing its caster, and URF must not zero a refill.
 *
 * Health has no equivalent rule and needs none: `MatchRules` is
 * `{ cooldownMultiplier, manaFree }`, so URF deliberately leaves `healthCost`
 * alone, and no spell in the tree sets a non-zero `healthCost` today (only
 * `Leblanc_R` touches it, zeroing the clone's). Health spending still goes
 * through the base class's commit/refund path.
 *
 * `spells/` (`packs/riot/spells/`) left this scan in content-pack-extraction
 * batch 5 task 6: this exact rule is now `src/seams/manaSpend.ts`, exported
 * so the pack can run it on *itself* (`packs/riot/package.json`'s own
 * `check-seams` script, with the pack's own debt declared in
 * `packs/riot/spells/seam-debt.mjs`) — proven with a planted violation whose
 * outcome was root `npm run verify` staying green while the pack's own
 * build went red. Before this move, this file scanning `packs/riot/spells`
 * directly meant the opposite: a pack-only violation still reddened core's
 * own `verify`, which is exactly the "the seam has not moved, it has been
 * copied" failure spec §8.1 exists to rule out. `coreSpells/`, `spellObjects/`
 * and `buffs/` stay — they are still core's own tree, not a pack's.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));

import Spell from '../../../src/game/gameObject/Spell';
import type { MatchRules } from '../../../src/game/config/PregameConfig';

/**
 * ## The source scan that used to live here is core's own `check-seams` now
 *
 * `npm run check-seams` (in `verify`) runs `src/seams/manaSpend.ts` — the
 * exported form of this exact rule — over `coreSpells/`, `spellObjects/`,
 * `buffs/` **and** `attackableUnits/`, one tree wider than the three this
 * file walked by hand. Batch 5 task 6 fix round 1 collapsed ten hand-written
 * duplicates into that CLI and the very next commit gave core its own
 * invocation of it, which re-created the duplication from the other side:
 * two implementations of one rule over one population, which is how they
 * drift. Proven before deleting, not assumed — a planted
 * `this.owner.stats.mana.baseValue -= 5` in `buffs/` produces
 * `mana-spend :: 4: this.owner.stats.mana.baseValue -= 5;` and exit 1.
 *
 * What is left below is the half the CLI has no equivalent for: what
 * `effectiveMana` and `spendMana` actually *do* under each match rule.
 */

class ProbeSpell extends Spell {
  manaCost = 40;

  rule(amount: number): number {
    return this.effectiveMana(amount);
  }

  spend(amount: number): boolean {
    return this.spendMana(amount);
  }
}

const probe = (mana: number, matchRules?: MatchRules) => {
  const stats = {
    mana: {
      baseValue: mana,
      get value() {
        return this.baseValue;
      },
      set value(value: number) {
        this.baseValue = value;
      },
    },
    health: { value: 100 },
  };
  return { spell: new ProbeSpell({ stats, game: { matchRules } }), stats };
};

describe('Spell.effectiveMana states the URF rule once', () => {
  it('charges the full amount with no match rules at all', () => {
    expect(probe(500).spell.rule(35)).toBe(35);
  });

  it('charges the full amount with URF off', () => {
    const { spell } = probe(500, { cooldownMultiplier: 1, manaFree: false });
    expect(spell.rule(35)).toBe(35);
    expect(spell.effectiveManaCost).toBe(spell.manaCost);
  });

  it('charges nothing with URF on, for the cost and for any other amount', () => {
    const { spell } = probe(500, { cooldownMultiplier: 1, manaFree: true });
    expect(spell.rule(35)).toBe(0);
    expect(spell.effectiveManaCost).toBe(0);
  });
});

describe('Spell.spendMana is the sanctioned spend path', () => {
  it('deducts the full amount and reports success when affordable', () => {
    const { spell, stats } = probe(100, { cooldownMultiplier: 1, manaFree: false });

    expect(spell.spend(35)).toBe(true);
    expect(stats.mana.value).toBe(65);
  });

  it('spends nothing and reports failure when the pool is short', () => {
    const { spell, stats } = probe(20, { cooldownMultiplier: 1, manaFree: false });

    expect(spell.spend(35)).toBe(false);
    expect(stats.mana.value).toBe(20);
  });

  it('succeeds without deducting under URF, even on an empty pool', () => {
    const { spell, stats } = probe(0, { cooldownMultiplier: 1, manaFree: true });

    expect(spell.spend(35)).toBe(true);
    expect(stats.mana.value).toBe(0);
  });
});
