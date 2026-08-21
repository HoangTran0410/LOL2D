import { beforeAll, describe, expect, it } from 'vitest';

import { spellGroups } from '../../../src/game/preset';
import { loadEverySpellForTests } from '../spell/registry';

// Spell classes arrive by dynamic import in the game (`spellRegistry.ts`);
// this fills the registry synchronously so a test can read the whole
// catalogue without awaiting 238 of them.
beforeAll(loadEverySpellForTests);

/**
 * The mechanism, not the tuning: every full-kit champion `spellGroups()`
 * offers must carry *some* attack profile, whichever installed pack supplied
 * it and whatever its six-or-however-many numbers are.
 *
 * The pack-specific assertions that used to live beside this one — the six
 * `ATTACK` role profiles' own gaps, ordering and dps bands — moved to
 * `tests/packs/riot/attackProfiles.test.ts` in a fix round: `ATTACK` itself
 * moved from `src/game/config/spellCatalog.ts` into `packs/riot/data.ts` (a
 * role taxonomy is the roster's vocabulary, not the engine's), so the test
 * that guards its specific numbers moved with it. This one stays here
 * because it names no pack's own values — it is a claim about
 * `spellGroups()`'s own behaviour, true for any installed pack.
 */
describe('basic-attack profiles', () => {
  it('every playable champion declares a profile', () => {
    // a champion left on the default is one that silently opted out of roles
    const unassigned: string[] = [];
    for (const group of spellGroups()) {
      // only champion shelves: these are the ones with a full four-spell kit
      if (!group.image?.startsWith('champ_')) continue;
      if (!group.attack) unassigned.push(group.name);
    }
    expect(unassigned).toEqual([]);
  });
});
