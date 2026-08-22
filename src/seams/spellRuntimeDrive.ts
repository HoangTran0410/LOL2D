import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { exemptionFor, readSource, stripComments, walkTsFiles } from './shared';

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
 * examples (a four-round recast ultimate and its own basic ability).
 */
export interface SpellRuntimeDriveOptions extends SeamCheckOptions {
  /**
   * Test files known to still reach past the runtime. Debt, not permission.
   * By path relative to the scanned root or by bare basename
   * (`exemptionFor`, `shared.ts`).
   *
   * Renamed from `grandfathered` in fix round 4 of content-pack-extraction
   * batch 5 task 6: `castSpecFrozen` already owned that field name, and
   * `checkSeams(root, options)` hands *one* options object to every seam —
   * so `packs/riot/spells/seam-debt.mjs`'s ten grandfathered cast specs
   * were being handed to this seam as test-file exemptions too. Inert only
   * because this seam ignores anything that is not a `*.test.ts`, which is
   * luck rather than design, and it is the same shape as the collision fix
   * round 3 found between the two other `grandfathered` fields. The
   * disjointness of these field names is now a test
   * (`tests/seams/seamOptionFields.test.ts`), not a convention.
   */
  grandfatheredTests?: Set<string>;
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

export const checkSpellRuntimeDrive: SeamCheckOf<SpellRuntimeDriveOptions> = (root, options) => {
  const grandfatheredTests = options?.grandfatheredTests ?? new Set<string>();
  // Which declared entries actually suppressed a real would-be violation
  // this run — the rest are stale. Fix round 4: this seam's own exemption
  // set was the one `src/seams/index.ts` never listed among "every licence
  // this module hands out", and so the one nothing ever checked.
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    if (!file.endsWith('.test.ts')) continue;
    const source = stripComments(readSource(root, file));
    const matches = source.match(CALL_PATTERN);
    if (!matches) continue;
    const exemption = exemptionFor(grandfatheredTests, file);
    if (exemption !== undefined) {
      consumed.add(exemption);
    } else {
      violations.push({ file, message: [...new Set(matches)].join(', ') });
    }
  }

  for (const entry of grandfatheredTests) {
    if (!consumed.has(entry)) {
      violations.push({
        file: entry,
        message:
          'grandfatheredTests exemption matched no scanned test that reaches past the runtime',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
