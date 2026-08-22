import type { SeamCheck, SeamCheckOptions, SeamViolation } from './types';
import { codeOnly, readSource, walkTsFiles } from './shared';

/**
 * A bot aims at the target it chose, never at `game.worldMouse` — on a phone
 * the cursor *is* the on-screen touch control, so a spell that reads it fires
 * at wherever the player's thumb rests. `Spell.aimPoint` / `CastContext` is
 * the replacement; `this.game.worldMouse` has no legitimate use inside a
 * spell's own activation code.
 *
 * The behavioural half — that a bot actually aims from its own target, not
 * the cursor — is a runtime test that stays in core
 * (`tests/game/integration/SpellAimIntegration.test.ts`), not something a
 * source scan can prove.
 */
const WORLD_MOUSE = 'this.game.worldMouse';

export interface WorldMouseInSpellCodeOptions extends SeamCheckOptions {
  /**
   * Known offending lines, `"<file>:<1-indexed line number>"` — content-pack-
   * extraction batch 5 task 6 fix round 1's answer to a real gap: every other
   * seam with debt exempts by file (`grandfathered`) or by name
   * (`noPressOverride`), but this rule's one known offender is a single line
   * inside a file that does nothing else wrong. Before this option existed,
   * the pack's `check-seams` build folded that whole file into the shared
   * `skip` set instead — clearing it from *every* seam, not just this one,
   * which would have let a second, unrelated violation in the same file go
   * unnoticed. `pinned` exempts only the named line; every other line in the
   * file, and every other seam, keep seeing it. Debt, not permission — a
   * name here needs the same kind of reason `grandfathered` sets ask for
   * elsewhere. (This module lives under `src/`, which `tests/content/
   * vocabularyBoundary.test.ts` bans Riot's own vocabulary from — the
   * concrete file and line for this pack's one known offender live in
   * `packs/riot/seam-debt.mjs`, not here.)
   *
   * Fix round 3: checked against the exact line it names, not just the
   * file — the sharpest staleness case of the four exemption shapes. A
   * file-level check would wave through a `pinned` entry whose line number
   * has drifted (an edit above it shifted every line down, say) even
   * though the *line it actually names* no longer reads `worldMouse` at
   * all — silently exempting whatever code now sits at that number.
   */
  pinned?: Set<string>;
}

export const checkWorldMouseInSpellCode: SeamCheck = (
  root,
  options?: WorldMouseInSpellCodeOptions
) => {
  const pinned = options?.pinned ?? new Set<string>();
  // Which declared `pinned` entries actually named a real `worldMouse`
  // line this run — the rest are stale (fix round 3).
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const lines = readSource(root, file).split('\n');
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const key = `${file}:${lineNumber}`;
      if (!codeOnly(line).includes(WORLD_MOUSE)) return;
      // Computed regardless of the exemption, unlike the old early
      // `return` — the exemption's own staleness depends on knowing
      // whether it would have mattered.
      if (pinned.has(key)) {
        consumed.add(key);
      } else {
        violations.push({ file, message: `${lineNumber}: ${line.trim()}` });
      }
    });
  }

  for (const key of pinned) {
    if (!consumed.has(key)) {
      violations.push({
        file: key,
        message:
          'pinned exemption matches nothing — this exact file:line no longer reads worldMouse (the line moved, the code changed, or the file does not exist)',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
