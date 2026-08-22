import type { SeamCheck, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

/**
 * A spell asks about walls one way: `sweepToWall`. The pieces underneath —
 * `wallOutlinesInArea` and `pointInWall` — are half-answers a spell can reach
 * past the seam for: raw polygon outlines with no help across the seams
 * between them, or a single-point sample a moving hook can overshoot or skip.
 *
 * See `tests/game/spells/terrain-field-seam.test.ts` for the five shipped
 * examples (a grapple hook, an anchoring hook, a shove, a knockback pin, a knockback ultimate).
 */
const BANNED = ['wallOutlinesInArea', 'pointInWall'];

export const checkTerrainField: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const source = stripComments(readSource(root, file));
    const found = BANNED.filter(name => new RegExp(`\\b${name}\\b`).test(source));
    if (found.length > 0) violations.push({ file, message: found.join(', ') });
  }
  return violations;
};
