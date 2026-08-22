import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';

/**
 * A tuning ceiling: no spell's numeric cooldown may exceed the match's
 * intended pace. Ten seconds is this game's own arcade boundary; a pack that
 * wants a different pace passes its own `maxMs`.
 *
 * See `tests/seams/exported-seams.test.ts`.
 */
export interface CooldownsOptions extends SeamCheckOptions {
  maxMs?: number;
}

const COOLDOWN_LITERAL = /coolDown\s*=\s*([\d_]+)/g;

export const checkCooldowns: SeamCheckOf<CooldownsOptions> = (root, options) => {
  const maxMs = options?.maxMs ?? 10_000;
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const source = readSource(root, file);
    for (const match of source.matchAll(COOLDOWN_LITERAL)) {
      const milliseconds = Number(match[1].replaceAll('_', ''));
      if (milliseconds > maxMs) {
        violations.push({ file, message: `coolDown ${milliseconds}ms exceeds ${maxMs}ms` });
      }
    }
  }
  return violations;
};
