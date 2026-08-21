import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';

/**
 * Every spell has to say how a thumb aims it: `Spell.castSpec` reads either a
 * spell's own `castSpec` override or the `targetingMode` field, and throws if
 * neither is set — but only the first time the spell is actually cast, which
 * would not catch a spell nobody happened to press before a release. This
 * catches it at build time instead.
 *
 * See `tests/game/spells/TargetingModeDeclared.test.ts`.
 */
const TARGETING_MODE_LITERAL = /targeting\s*:\s*'(?:SELF|DIRECTION|POINT|UNIT)'/;
const TARGETING_MODE_FIELD = /\btargetingMode\s*[:=]/;

export const checkTargetingModeDeclared: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const source = readSource(root, file);
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
