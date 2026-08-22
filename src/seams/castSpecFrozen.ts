import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { exemptionFor, readSource, stripComments, walkTsFiles } from './shared';

/**
 * `castSpec` is read once, on the first cast, and never again — `Spell.runtime`
 * is a lazy getter that freezes whatever `castSpec` returned on the opening
 * press. A getter that computes any of it from live state therefore describes
 * the spell as it was on the opening press, for the rest of the match.
 *
 * See `tests/seams/exported-seams.test.ts` for the worked example
 * (a four-round recast ultimate computing its recast cooldown from `shotsRemaining`).
 */
export interface CastSpecFrozenOptions extends SeamCheckOptions {
  /**
   * Spells known to still read live state — debt, not permission. An entry
   * names a file: either its path relative to the scanned root, or its bare
   * basename, which matches at any depth (`exemptionFor` in `shared.ts` —
   * one keying rule for every exemption set in this module since fix round
   * 4, after a nested file made a live entry report as stale).
   */
  grandfathered?: Set<string>;
}

/**
 * Fields that genuinely do not change over a spell's life, so reading them in
 * the getter says the same thing on every read.
 */
const CONSTANT_FIELDS = new Set([
  'coolDown',
  'owner',
  'game',
  'image',
  'range',
  'manaCost',
  'healthCost',
  'targetingMode',
  'name',
]);

/** The body of `get castSpec() { … }`, brace-matched so nested objects survive. */
function castSpecBody(source: string): string | null {
  const opener = /get castSpec\([^)]*\)[^{]*\{/.exec(source);
  if (!opener) return null;

  let index = opener.index + opener[0].length;
  let depth = 1;
  const start = index;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  return source.slice(start, index - 1);
}

function liveStateReads(body: string): string[] {
  const seen = new Set<string>();
  for (const [, field] of body.matchAll(/\bthis\.(\w+)/g)) {
    if (!CONSTANT_FIELDS.has(field)) seen.add(`this.${field}`);
  }
  return [...seen].sort();
}

export const checkCastSpecFrozen: SeamCheckOf<CastSpecFrozenOptions> = (root, options) => {
  const grandfathered = options?.grandfathered ?? new Set<string>();
  // Which declared `grandfathered` entries actually suppressed a real
  // would-be violation this run — the rest are stale (fix round 3).
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    // Computed regardless of the exemption, unlike the old `if
    // (grandfathered.has(file)) continue;` short-circuit — the exemption's
    // own staleness depends on knowing whether it would have mattered.
    const body = castSpecBody(stripComments(readSource(root, file)));
    if (body === null) continue;
    const reads = liveStateReads(body);
    if (reads.length === 0) continue;

    const exemption = exemptionFor(grandfathered, file);
    if (exemption !== undefined) {
      consumed.add(exemption);
    } else {
      violations.push({ file, message: reads.join(', ') });
    }
  }

  for (const entry of grandfathered) {
    if (!consumed.has(entry)) {
      violations.push({
        file: entry,
        // Says only what the scan actually observed. The previous wording
        // named three causes ("no longer reads live state, has no castSpec
        // getter, or does not exist") and fix round 4's reproduction hit a
        // case where all three were false — the file existed, had a getter
        // and read live state, and the entry was mis-keyed. A message that
        // lists causes it has not checked sends the reader hunting.
        message: 'grandfathered exemption matched no scanned file whose castSpec reads live state',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
