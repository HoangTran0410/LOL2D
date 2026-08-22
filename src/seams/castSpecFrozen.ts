import type { SeamCheck, SeamCheckOptions, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

/**
 * `castSpec` is read once, on the first cast, and never again — `Spell.runtime`
 * is a lazy getter that freezes whatever `castSpec` returned on the opening
 * press. A getter that computes any of it from live state therefore describes
 * the spell as it was on the opening press, for the rest of the match.
 *
 * See `tests/game/spells/castspec-frozen-seam.test.ts` for the worked example
 * (a four-round recast ultimate computing its recast cooldown from `shotsRemaining`).
 */
export interface CastSpecFrozenOptions extends SeamCheckOptions {
  /** Spells known to still read live state — debt, not permission. */
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

export const checkCastSpecFrozen: SeamCheck = (root, options?: CastSpecFrozenOptions) => {
  const grandfathered = options?.grandfathered ?? new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    if (grandfathered.has(file)) continue;
    const body = castSpecBody(stripComments(readSource(root, file)));
    if (body === null) continue;
    const reads = liveStateReads(body);
    if (reads.length > 0) violations.push({ file, message: reads.join(', ') });
  }
  return violations;
};
