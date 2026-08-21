import type { SeamCheck, SeamViolation } from './types';
import { codeOnly, readSource, walkTsFiles } from './shared';

/**
 * Current health and current mana are resources, not stats. `Stats` exposes
 * them as `Stat` objects so the health bar can read one number, but
 * everything that legitimately moves them writes `baseValue` directly.
 * Nothing moves them through the modifier pipeline — a bonus on `health:` or
 * `mana:` changes the number the bar reads while leaving the pool the game
 * actually spends untouched.
 *
 * See `tests/game/spells/stat-resource-modifier.test.ts`.
 */
const RESOURCE_AS_STAT = /(?<![A-Za-z])(?:health|mana)\s*:\s*\{/;

export const checkStatResourceModifier: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const lines = readSource(root, file).split('\n');
    lines.forEach((line, index) => {
      const code = codeOnly(line);
      if (RESOURCE_AS_STAT.test(code)) {
        violations.push({ file, message: `${index + 1}: ${line.trim()}` });
      }
    });
  }
  return violations;
};
