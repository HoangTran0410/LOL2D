import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
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
 * See `tests/game/spells/aoe-display-bounds.test.ts` (a beam
 * ultimate's beam, and the behavioural half — `aoe-display-bounds.test.ts` — that
 * checks the box is actually big enough, which this scan cannot).
 */
export interface SpellObjectDisplayBoxOptions extends SeamCheckOptions {
  /**
   * Class names known to predate the rule and stay caster-centred. Named
   * `grandfatheredClasses`, not `grandfathered` — content-pack-extraction
   * batch 5 task 6 fix round 3: `checkSeams(root, options)` hands one
   * options object to all thirteen seams, and `castSpecFrozen`'s own
   * `grandfathered` is file-basename-keyed while this one is class-name-
   * keyed. Sharing the field name was harmless for suppressing violations
   * (the two vocabularies never collided in practice), but it broke
   * stale-exemption checking outright: each seam would see the *other*
   * seam's entries in its own set and report every one of them stale,
   * since a class name never matches a file basename or vice versa. A
   * distinct field name per seam is what makes "did this specific seam
   * actually consume this specific entry" answerable at all.
   */
  grandfatheredClasses?: Set<string>;
}

/** Only classes extending `SpellObject` directly. */
const DIRECT_SPELL_OBJECT = /class\s+(\w+)\s+extends\s+SpellObject\b[^{]*\{/g;

/** Either sanctioned way to state an extent. */
const STATES_ITS_EXTENT = /getDisplayBoundingBox\s*\(|\bvisionRadius\b/;

export const checkSpellObjectDisplayBox: SeamCheckOf<SpellObjectDisplayBoxOptions> = (
  root,
  options
) => {
  const grandfatheredClasses = options?.grandfatheredClasses ?? new Set<string>();
  // Which declared `grandfatheredClasses` entries actually suppressed a
  // real would-be violation this run — the rest are stale (fix round 3).
  const consumed = new Set<string>();
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
      // Computed regardless of the exemption, unlike the old `if
      // (grandfathered.has(className)) continue;` short-circuit — the
      // exemption's own staleness depends on knowing whether it would
      // have mattered.
      if (grandfatheredClasses.has(className)) {
        consumed.add(className);
      } else {
        violations.push({ file, message: `${className} inherits a zero-area display box` });
      }
    }
  }

  for (const className of grandfatheredClasses) {
    if (!consumed.has(className)) {
      violations.push({
        file: className,
        // Only what the scan observed — see `castSpecFrozen.ts`'s own note
        // on why a stale report does not list causes it never checked.
        // This set alone is keyed by *class name*, not by file, so
        // `exemptionFor`'s path-or-basename rule does not apply to it:
        // a class name has no path to be relative to.
        message:
          'grandfatheredClasses exemption matched no scanned class inheriting a zero-area display box',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
