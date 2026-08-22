import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { codeOnly, parsePinnedLine, pinnedLineFor, readSource, walkTsFiles } from './shared';

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

export interface ManaSpendOptions extends SeamCheckOptions {
  /**
   * Known lines that name a mana stat for a reason this rule cannot see —
   * `"<file>:<1-indexed line>:<the line's own code, trimmed>"`, the same
   * shape `worldMouseInSpellCode`'s `pinned` uses and checked by the same
   * `pinnedLineFor` (`shared.ts`), so a licence is issued to a line's
   * *content* and not to its position.
   *
   * Named `pinnedManaLines`, not `pinned`: `checkSeams(root, options)`
   * hands one options object to every seam, so two seams sharing a field
   * name would each see the other's entries in its own set and report every
   * one of them stale — the collision fix round 3 found between two
   * `grandfathered` fields. `tests/seams/seamOptionFields.test.ts` is what
   * makes that impossible rather than merely fixed.
   *
   * Content-pack-extraction batch 5 task 6 fix round 4: this exists so
   * core's own `attackableUnits/` tree can be *scanned* rather than
   * excluded wholesale. Two of its seven files name a mana stat
   * legitimately — `AttackableUnit.restoreMana()`, the sanctioned granting
   * path ("granting is not billing", CLAUDE.md), and `Champion`'s health-bar
   * read, which is a HUD read and not a spend at all — and pinning those two
   * lines individually is what brings the other five files into scope.
   */
  pinnedManaLines?: Set<string>;
}

export const checkManaSpend: SeamCheckOf<ManaSpendOptions> = (root, options) => {
  const pinnedManaLines = options?.pinnedManaLines ?? new Set<string>();
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const lines = readSource(root, file).split('\n');
    lines.forEach((line, index) => {
      const code = codeOnly(line);
      if (!TOUCHES_MANA.test(code) || SANCTIONED.test(code)) return;
      // Computed regardless of the exemption: the exemption's own staleness
      // depends on knowing whether it would have mattered.
      const entry = pinnedLineFor(pinnedManaLines, file, index + 1, line);
      if (entry !== undefined) {
        consumed.add(entry);
      } else {
        violations.push({ file, message: `${index + 1}: ${line.trim()}` });
      }
    });
  }

  for (const entry of pinnedManaLines) {
    if (consumed.has(entry)) continue;
    violations.push({
      file: entry,
      message:
        parsePinnedLine(entry) === null
          ? 'pinnedManaLines exemption is not a "<file>:<line>:<code>" entry, so it can never match a line'
          : 'pinnedManaLines exemption matched no scanned line naming a mana stat with that file, line number and code',
      kind: 'stale-exemption',
    });
  }

  return violations;
};
