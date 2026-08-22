import type { SeamCheck, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

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

export const checkTargetVision: SeamCheck = (root, options) => {
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
      violations.push({ file, message: 'reads the fog draw flag to decide targeting' });
    }
  }
  return violations;
};
