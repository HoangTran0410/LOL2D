import type { SeamCheck, SeamCheckOptions, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

/**
 * A `SpellObject` that paints past its own centre owes the quadtree a box.
 * `GameObject.getDisplayBoundingBox` derives the box from `visionRadius`,
 * which is 0 for a plain `SpellObject` — a zero-area box sitting on the
 * object's own centre, so an effect painting a 400px cone but reporting a
 * zero-size box is drawn only while its *centre point* is on screen.
 *
 * Two ways to satisfy it: declare `getDisplayBoundingBox()`, or set a
 * non-zero `visionRadius`.
 *
 * See `tests/game/spells/spell-object-display-box-seam.test.ts` (a beam
 * ultimate's beam, and the behavioural half — `aoe-display-bounds.test.ts` — that
 * checks the box is actually big enough, which this scan cannot).
 */
export interface SpellObjectDisplayBoxOptions extends SeamCheckOptions {
  /** Class names known to predate the rule and stay caster-centred. */
  grandfathered?: Set<string>;
}

/** Only classes extending `SpellObject` directly. */
const DIRECT_SPELL_OBJECT = /class\s+(\w+)\s+extends\s+SpellObject\b[^{]*\{/g;

/** Either sanctioned way to state an extent. */
const STATES_ITS_EXTENT = /getDisplayBoundingBox\s*\(|\bvisionRadius\b/;

export const checkSpellObjectDisplayBox: SeamCheck = (
  root,
  options?: SpellObjectDisplayBoxOptions
) => {
  const grandfathered = options?.grandfathered ?? new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const source = stripComments(readSource(root, file));
    const pattern = new RegExp(DIRECT_SPELL_OBJECT.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const className = match[1];
      let depth = 0;
      let end = source.length;
      for (let index = pattern.lastIndex - 1; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = index;
            break;
          }
        }
      }
      const body = source.slice(pattern.lastIndex, end);
      if (STATES_ITS_EXTENT.test(body)) continue;
      if (grandfathered.has(className)) continue;
      violations.push({ file, message: `${className} inherits a zero-area display box` });
    }
  }
  return violations;
};
