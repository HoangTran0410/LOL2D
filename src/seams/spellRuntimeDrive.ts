import type { SeamCheck, SeamCheckOptions, SeamViolation } from './types';
import { readSource, stripComments, walkTsFiles } from './shared';

/**
 * A spell test drives the spell, not one of its hooks. `onSpellCast` and its
 * siblings are hooks the *runtime* calls — calling one by hand runs that hook
 * alone: no activation pattern, no recast budget, no `onComplete`, no
 * resource commit, no cooldown, no targeting rejection. The sanctioned way in
 * is `pressSpell` / `releaseSpell`, or `spell.press(context)` directly — the
 * ban is on reaching past the runtime, not on a helper being mandatory.
 *
 * This scans **test files** (`*.test.ts`), not spell source — the population
 * is a pack's own spell test suite.
 *
 * See `tests/game/spells/spell-runtime-drive-seam.test.ts` for the shipped
 * examples (Jhin R, Jhin Q).
 */
export interface SpellRuntimeDriveOptions extends SeamCheckOptions {
  /** Test files known to still reach past the runtime. Debt, not permission. */
  grandfathered?: Set<string>;
}

const RUNTIME_HOOKS = [
  'onSpellCast',
  'onCastStart',
  'onChargeUpdate',
  'onRelease',
  'onChannelTick',
  'onActivate',
  'onRecast',
  'onCancel',
  'onComplete',
] as const;

/** `.onSpellCast(` and friends. `super.onSpellCast(` is a legitimate delegation. */
const CALL_PATTERN = new RegExp(`(?<!super)\\.\\s*(?:${RUNTIME_HOOKS.join('|')})\\s*\\(`, 'g');

export const checkSpellRuntimeDrive: SeamCheck = (root, options?: SpellRuntimeDriveOptions) => {
  const grandfathered = options?.grandfathered ?? new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    if (!file.endsWith('.test.ts')) continue;
    if (grandfathered.has(file)) continue;
    const source = stripComments(readSource(root, file));
    const matches = source.match(CALL_PATTERN);
    if (matches) violations.push({ file, message: [...new Set(matches)].join(', ') });
  }
  return violations;
};
