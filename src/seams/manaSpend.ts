import type { SeamCheck, SeamViolation } from './types';
import { codeOnly, readSource, walkTsFiles } from './shared';

/**
 * URF (`matchRules.manaFree`) is meant to be a single flip, not a per-spell
 * edit: `Spell.effectiveMana()` states the rule once and `Spell.spendMana()`
 * is the only sanctioned way for a spell to bill its caster. A spell that
 * drains `owner.stats.mana.baseValue` against a raw number keeps charging —
 * and keeps shutting itself off at low mana — with URF on. Nothing in `tsc`
 * catches that: the write is perfectly well typed.
 *
 * See `tests/game/spells/mana-spend-seam.test.ts` for the worked example
 * (an upkeep-channel ultimate) and for the parts of this rule that stay core-only: unit-side
 * mana plumbing (fountains, regen, refills) is deliberately out of scope, and
 * is checked by that test against core's own fixed directories rather than
 * an arbitrary content tree.
 */
const TOUCHES_MANA = /\bstats\.mana\b|\bmana\.(?:baseValue|current)\b/;

/**
 * The one form allowed to name a mana stat outside `Spell` itself: the base
 * class's own writer, handed an amount the caller already put through
 * `effectiveManaCost`.
 */
const SANCTIONED = /this\.changeResource\(\s*this\.owner\.stats\.mana\s*,/;

export const checkManaSpend: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const lines = readSource(root, file).split('\n');
    lines.forEach((line, index) => {
      const code = codeOnly(line);
      if (TOUCHES_MANA.test(code) && !SANCTIONED.test(code)) {
        violations.push({ file, message: `${index + 1}: ${line.trim()}` });
      }
    });
  }
  return violations;
};
