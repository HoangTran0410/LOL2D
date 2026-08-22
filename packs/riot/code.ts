import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { ContentPackCode, SpellSource } from '@moba2d/core/content/ContentPack';
import { spellModules } from './generated/spellModules';
import makeBaronAbilities from './monsters/Baron';

/**
 * This pack's code half: real engine classes, built from the injected
 * `api` — 237 spells behind `./generated/spellModules.ts`'s dynamic
 * imports, and Baron's abilities.
 *
 * Deliberately its own file, sibling to `./data.ts` rather than folded into
 * it (batch 4 task 7 — see `./pack.ts`'s own header). `install.ts` — core,
 * not this pack — is what folds core's own `BasicAttack` *and* `Recall`
 * spells on top of what this factory returns: a pack file may not import
 * `@/generated/spellModules` or `@/game/gameObject/coreSpells/Recall`
 * (the `pack-core-boundary` seam allows only
 * `@moba2d/core/content/ContentApi`/`ContentPack`/`types`, type-only), and "a bare
 * spell id always resolves against this pack" is a promise `qualifySpellId`
 * makes about the *whole* installed `riot` entry, `BasicAttack` and `Recall`
 * included — not something this pack's own data is entitled to decide on
 * core's behalf. `./data.ts`'s `championEntries()` still names every
 * champion's way home as the bare string `'Recall'` (`recall: 'Recall'`);
 * `install.ts` is what makes that id resolve to a real class, exactly the
 * way it already does for the bare `'BasicAttack'` every kit's slot 0 names.
 */
const spellSources = (api: ContentApi): Record<string, SpellSource> => {
  const out: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    out[id] = () => load().then(module => module.default(api));
  }
  return out;
};

/**
 * `api` is used here and nowhere else in this pack: `./data.ts` is pure data
 * and never touches it. Baron is the only monster with a code half today —
 * see `./monsters/Baron.ts`'s own header for why abilities live in the code
 * half rather than on `MonsterBody`/`MonsterDef`.
 */
const code = (api: ContentApi): ContentPackCode => ({
  spells: spellSources(api),
  monsterAbilities: {
    baron: makeBaronAbilities(api),
  },
});

export default code;
