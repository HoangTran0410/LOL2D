import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { exemptionFor, readSource, stripComments, walkTsFiles } from './shared';

/**
 * A spell that picks an enemy for you must first be able to see them.
 * `PredefinedFilters.visibleTo` is the gate; `combat/Vision.ts` is what it
 * asks. A net, not a proof: an auto-lock written some other way slips
 * through, and area effects are deliberately out of scope — vision gates
 * target *acquisition*, never damage application.
 *
 * The worked example (a leap ability finding a camp through a wall) used to
 * live as a hand-written scan of `packs/riot/spells/` in
 * `tests/game/spells/target-vision-seam.test.ts`; content-pack-extraction
 * batch 5 task 6 fix round 1 removed that file — its whole population was
 * pack content (core's own `coreSpells/` neither auto-locks nor reads the
 * fog flag) — in favour of `packs/riot`'s own `check-seams` script running
 * this exported function directly. See `tests/seams/exported-seams.test.ts`
 * for the synthetic proof.
 */
const PICKS_ONE_UNIT = /nearestDistance|closestDistance|nearestDist\b|minD\b/;

/** A query restricted to the caster's own team never needed the fog. */
const ALLIES_ONLY = /PredefinedFilters\.teamId\(/;

/** `FogOfWar`'s own draw flag — a *draw* question, not a targeting one. */
const FOG_DRAW_FLAG = /\bwillDraw\b|\bvisibleToPlayerTeam\b/;

export interface TargetVisionOptions extends SeamCheckOptions {
  /**
   * Files that name the fog draw flag for a reason that is not targeting —
   * by path relative to the scanned root or by bare basename
   * (`exemptionFor`, `shared.ts`). Debt, not permission, and empty for
   * every content tree: a spell has no business reading it at all.
   *
   * Content-pack-extraction batch 5 task 6 fix round 4: core's own
   * `attackableUnits/` tree is the population — `AttackableUnit` *declares*
   * `visibleToPlayerTeam`, the flag `FogOfWar.calculateSight` writes and the
   * draw cull reads. Pinning that one file is what lets the directory be
   * scanned instead of excluded from the whole set of rules.
   */
  grandfatheredFogReads?: Set<string>;
}

export const checkTargetVision: SeamCheckOf<TargetVisionOptions> = (root, options) => {
  const grandfatheredFogReads = options?.grandfatheredFogReads ?? new Set<string>();
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const source = stripComments(readSource(root, file));

    if (
      source.includes('queryObjects') &&
      PICKS_ONE_UNIT.test(source) &&
      !ALLIES_ONLY.test(source) &&
      !source.includes('PredefinedFilters.visibleTo')
    ) {
      violations.push({
        file,
        message: 'auto-locks a query without PredefinedFilters.visibleTo',
      });
    }

    if (FOG_DRAW_FLAG.test(source)) {
      const exemption = exemptionFor(grandfatheredFogReads, file);
      if (exemption !== undefined) {
        consumed.add(exemption);
      } else {
        violations.push({ file, message: 'reads the fog draw flag to decide targeting' });
      }
    }
  }

  for (const entry of grandfatheredFogReads) {
    if (!consumed.has(entry)) {
      violations.push({
        file: entry,
        message: 'grandfatheredFogReads exemption matched no scanned file naming the fog draw flag',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
