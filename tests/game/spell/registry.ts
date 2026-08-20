import * as AllSpells from '../../../src/game/gameObject/spells/index';
import * as CoreSpells from '../../../src/game/gameObject/coreSpells/index';
import { registerSpellForTests, resetSpellRegistryForTests } from '../../../src/game/spellRegistry';

/**
 * Fill the spell registry, synchronously, for tests that need the whole
 * catalogue resolvable.
 *
 * In the game the registry is filled by dynamic import, one chunk per champion
 * (`src/game/spellRegistry.ts`). A test that wants to walk every champion's kit
 * does not want 238 `await import()`s and the transform cost that comes with
 * them, and it does not need them: `spells/index.ts` and `coreSpells/index.ts`
 * are still the two barrels the generator reads to build `spellModules.ts`, so
 * importing both here registers exactly the same set the browser would end up
 * with.
 *
 * That equivalence is the thing to protect, and `spellRegistry.test.ts` asserts
 * it — barrel keys and generated module keys must be the same set, or this
 * helper is quietly testing a different game than the one that ships.
 */
export function loadEverySpellForTests(): void {
  resetSpellRegistryForTests();
  for (const [id, spellClass] of Object.entries({ ...AllSpells, ...CoreSpells })) {
    if (typeof spellClass === 'function') registerSpellForTests(id, spellClass);
  }
}

export { AllSpells, CoreSpells };
