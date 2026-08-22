import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { exemptionFor, readSource, stripComments, walkTsFiles } from './shared';

/**
 * A `UNIT` spell says whose body it is allowed to pick. `TargetResolver`
 * defaults `targetTeam` to `'ANY'`, and its candidate list includes the
 * caster — so a `UNIT` spell that does not declare a team, cast with the
 * cursor over empty ground, resolves *itself* through the nearest-to-cursor
 * fallback. Three declarations make it impossible: `targetTeam` inside
 * `targetingRequest`, and a `press()` override that runs `TargetResolver`
 * when the incoming context carries no target.
 *
 * The shipped examples (four unit-targeted spells across four different
 * champions) used to live as a hand-written scan of `packs/riot/spells/` in
 * `tests/game/spells/unit-target-team-seam.test.ts`; content-pack-extraction
 * batch 5 task 6 fix round 1 removed that file — its whole population was
 * pack content (core's own `coreSpells/` has no `UNIT`-targeted spell at
 * all) — in favour of `packs/riot`'s own `check-seams` script running this
 * exported function directly. See `tests/seams/exported-seams.test.ts` for
 * the synthetic proof.
 */
export interface UnitTargetTeamOptions extends SeamCheckOptions {
  /**
   * Files known to resolve correctly on the path the game actually uses
   * (`Game.createSpellContext` runs `TargetResolver` before `press` is ever
   * called) and so do not need their own `press()` override. Debt, not
   * permission — empty by default. An entry names a file by its path
   * relative to the scanned root or by its bare basename, the one keying
   * rule every exemption set in this module shares (`exemptionFor` in
   * `shared.ts`, fix round 4).
   */
  noPressOverride?: Set<string>;
}

export const checkUnitTargetTeam: SeamCheckOf<UnitTargetTeamOptions> = (root, options) => {
  const noPressOverride = options?.noPressOverride ?? new Set<string>();
  // Which declared `noPressOverride` entries actually suppressed a real
  // would-be violation this run — the rest are stale (fix round 3).
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const source = stripComments(readSource(root, file));
    if (!/targeting:\s*'UNIT'/.test(source)) continue;

    if (!/targetTeam\s*:/.test(source)) {
      violations.push({ file, message: 'UNIT spell declares no targetTeam' });
    }
    if (!/targetingRequest/.test(source)) {
      violations.push({ file, message: 'UNIT spell supplies no targetingRequest' });
    }
    // Computed regardless of the exemption, unlike the old `if
    // (!noPressOverride.has(file) && ...)` short-circuit — the exemption's
    // own staleness depends on knowing whether it would have mattered.
    if (!/\bpress\s*\(/.test(source)) {
      const exemption = exemptionFor(noPressOverride, file);
      if (exemption !== undefined) {
        consumed.add(exemption);
      } else {
        violations.push({
          file,
          message: 'UNIT spell has no press() to refuse an unresolved context',
        });
      }
    }
  }

  for (const entry of noPressOverride) {
    if (!consumed.has(entry)) {
      violations.push({
        file: entry,
        // Only what the scan observed — see `castSpecFrozen.ts`'s own note
        // on why a stale report does not list causes it never checked.
        message: 'noPressOverride exemption matched no scanned UNIT spell that lacks a press()',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
