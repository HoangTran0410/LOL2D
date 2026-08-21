import type { SeamCheck, SeamViolation } from './types';
import { codeOnly, readSource, walkTsFiles } from './shared';

/**
 * A bot aims at the target it chose, never at `game.worldMouse` — on a phone
 * the cursor *is* the on-screen touch control, so a spell that reads it fires
 * at wherever the player's thumb rests. `Spell.aimPoint` / `CastContext` is
 * the replacement; `this.game.worldMouse` has no legitimate use inside a
 * spell's own activation code.
 *
 * This is the static half of `tests/game/integration/SpellAimIntegration.test.ts`
 * ("keeps shared worldMouse out of spell activation code"); the behavioural
 * half — that a bot actually aims from its own target, not the cursor — is a
 * runtime test that stays in core, not something a source scan can prove.
 */
const WORLD_MOUSE = 'this.game.worldMouse';

export const checkWorldMouseInSpellCode: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const lines = readSource(root, file).split('\n');
    lines.forEach(line => {
      if (codeOnly(line).includes(WORLD_MOUSE)) {
        violations.push({ file, message: line.trim() });
      }
    });
  }
  return violations;
};
