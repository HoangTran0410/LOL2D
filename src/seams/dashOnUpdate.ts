import type { SeamCheck, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

/**
 * Nobody may assign `onUpdate` onto a `Dash` (or any buff that implements its
 * own). `Buff.update()` calls `this.onUpdate()`, and `Dash` implements the
 * movement in `Dash.prototype.onUpdate`; an instance assignment shadows the
 * prototype, so what looks like a per-frame callback silently deletes the
 * step towards the destination. Use `onDashUpdate`, which the base calls.
 *
 * See `tests/game/spells/dash-onupdate-seam.test.ts` for the shipped
 * examples (three separate dash spells across three champions) and the behavioural half that proves
 * `onDashUpdate` still moves the champion.
 */
const ON_UPDATE_ASSIGNMENT = /\b\w+\.onUpdate\s*=/g;

export const checkDashOnUpdate: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const source = stripComments(readSource(root, file));
    const matches = source.match(ON_UPDATE_ASSIGNMENT);
    if (matches) violations.push({ file, message: matches.join(', ') });
  }
  return violations;
};
