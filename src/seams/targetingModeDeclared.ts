import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';

/**
 * Every spell has to say how a thumb aims it: `Spell.castSpec` reads either a
 * spell's own `castSpec` override or the `targetingMode` field, and throws if
 * neither is set — but only the first time the spell is actually cast, which
 * would not catch a spell nobody happened to press before a release. This
 * catches it at build time instead.
 *
 * Gated on the file actually defining a spell class — `class X extends
 * Spell` (the injected-API pattern aliases `api.Spell` to a local `Spell`
 * first, so `extends api.Spell` is matched too). Every other check in this
 * directory fires on the *presence* of a mistake, which is naturally quiet
 * on a file with none; this one fires on an *absence*, so without its own
 * gate it flags every `.ts` file that is not a spell at all. The CLI's
 * documented invocation is a pack's whole source root
 * (`node scripts/check-seams.mjs ./packs/reference`), not just its `spells/`
 * subdirectory, and `packs/reference/map.ts`, `pack.ts` and
 * `provingGroundsGeometry.ts` — none of them spells — were three false
 * positives from exactly that root.
 *
 * See `tests/seams/exported-seams.test.ts`.
 */
const TARGETING_MODE_LITERAL = /targeting\s*:\s*'(?:SELF|DIRECTION|POINT|UNIT)'/;
const TARGETING_MODE_FIELD = /\btargetingMode\s*[:=]/;
const DEFINES_SPELL_CLASS = /\bclass\s+\w+\s+extends\s+(?:api\.)?Spell\b/;

export const checkTargetingModeDeclared: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const source = readSource(root, file);
    if (!DEFINES_SPELL_CLASS.test(source)) continue;
    const declaresItsOwnTargeting = TARGETING_MODE_LITERAL.test(source);
    const setsTargetingMode = TARGETING_MODE_FIELD.test(source);
    if (!declaresItsOwnTargeting && !setsTargetingMode) {
      violations.push({
        file,
        message:
          "declares neither a 'targeting' literal in its own castSpec nor a `targetingMode` field",
      });
    }
  }
  return violations;
};
