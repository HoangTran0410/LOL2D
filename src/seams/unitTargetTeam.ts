import type { SeamCheck, SeamCheckOptions, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

/**
 * A `UNIT` spell says whose body it is allowed to pick. `TargetResolver`
 * defaults `targetTeam` to `'ANY'`, and its candidate list includes the
 * caster — so a `UNIT` spell that does not declare a team, cast with the
 * cursor over empty ground, resolves *itself* through the nearest-to-cursor
 * fallback. Three declarations make it impossible: `targetTeam` inside
 * `targetingRequest`, and a `press()` override that runs `TargetResolver`
 * when the incoming context carries no target.
 *
 * See `tests/game/spells/unit-target-team-seam.test.ts` for the shipped
 * examples (four unit-targeted spells across four different champions).
 */
export interface UnitTargetTeamOptions extends SeamCheckOptions {
  /**
   * Files known to resolve correctly on the path the game actually uses
   * (`Game.createSpellContext` runs `TargetResolver` before `press` is ever
   * called) and so do not need their own `press()` override. Debt, not
   * permission — empty by default.
   */
  noPressOverride?: Set<string>;
}

export const checkUnitTargetTeam: SeamCheck = (root, options?: UnitTargetTeamOptions) => {
  const noPressOverride = options?.noPressOverride ?? new Set<string>();
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
    if (!noPressOverride.has(file) && !/\bpress\s*\(/.test(source)) {
      violations.push({
        file,
        message: 'UNIT spell has no press() to refuse an unresolved context',
      });
    }
  }
  return violations;
};
