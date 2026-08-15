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
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));

import Spell from '../../../src/game/gameObject/Spell';
import type { MatchRules } from '../../../src/game/config/PregameConfig';

const SCANNED_DIRECTORIES = ['spells', 'spellObjects', 'buffs'];

/** Any read or write of a caster's mana pool. */
const TOUCHES_MANA = /\bstats\.mana\b|\bmana\.(?:baseValue|current)\b/;

/**
 * The one form allowed to name a mana stat outside `Spell` itself: the base
 * class's own writer, handed an amount the caller already put through
 * `effectiveManaCost`. Pantheon Q, Malphite E and Varus Q each refund half
 * their cost on cancel this way. `spendMana()` (which applies the rule for
 * you) is preferred for new code; this form stays legal because it is still
 * reading the rule, just at the call site.
 */
const SANCTIONED = /this\.changeResource\(\s*this\.owner\.stats\.mana\s*,/;

const gameObjectRoot = fileURLToPath(new URL('../../../src/game/gameObject/', import.meta.url));

const sourceFiles = (directory: string): string[] => {
  const absolute = join(gameObjectRoot, directory);
  return readdirSync(absolute, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => join(directory, entry));
};

/**
 * The scan reads code, not prose: a comment has to stay free to name the thing
 * it is explaining, the way `Anivia_R`'s upkeep comment now names `stats.mana`
 * to say precisely what it stopped doing.
 */
const codeOnly = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  return line.split('//')[0];
};

const offendingLines = (relativePath: string): string[] =>
  readFileSync(join(gameObjectRoot, relativePath), 'utf8')
    .split('\n')
    .map((line, index) => ({ code: codeOnly(line), line, number: index + 1 }))
    .filter(({ code }) => TOUCHES_MANA.test(code) && !SANCTIONED.test(code))
    .map(({ line, number }) => `${relativePath}:${number}: ${line.trim()}`);

describe('spells bill mana only through the URF-aware seam on Spell', () => {
  it.each(SCANNED_DIRECTORIES)('no file under %s/ touches a mana stat directly', directory => {
    const offenders = sourceFiles(directory).flatMap(offendingLines);
    expect(offenders).toEqual([]);
  });
});

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
