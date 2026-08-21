import type { ContentApi } from '@/content/ContentApi';
import type { ContentPackCode, SpellSource } from '@/content/ContentPack';
import { spellModules } from './generated/spellModules';
import makeBaronAbilities from './monsters/Baron';

/**
 * This pack's code half: real engine classes, built from the injected
 * `api` — 237 spells behind `./generated/spellModules.ts`'s dynamic
 * imports, `Recall` (loaded the same lazy way, for the reason its own line
 * below explains), and Baron's abilities.
 *
 * Deliberately its own file, sibling to `./data.ts` rather than folded into
 * it (batch 4 task 7 — see `./pack.ts`'s own header). `install.ts` — core,
 * not this pack — is what folds core's own `BasicAttack` spell on top of
 * what this factory returns: a pack file may not import
 * `@/generated/spellModules` (`tests/content/packBoundary.test.ts` allows
 * only `@/content/ContentApi`/`ContentPack`/`types`, type-only), and "a bare
 * spell id always resolves against this pack" is a promise `qualifySpellId`
 * makes about the *whole* installed `riot` entry, BasicAttack included — not
 * something this pack's own data is entitled to decide on core's behalf.
 */
const spellSources = (api: ContentApi): Record<string, SpellSource> => {
  const out: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    out[id] = () => load().then(module => module.default(api));
  }
  // Not in `spellModules`, on purpose: `Recall` is out of `spells/index.ts` so
  // that it can never reach the loadout picker, which is also why it gets no
  // `spellDisplay` entry. `preset.ts` reaches it directly and synchronously
  // for every match (`attachRecall`, a named, pinned exception — see
  // `tests/content/coreSpells.test.ts`), so nothing here needs it loaded
  // eagerly a second time. A loader — the same shape every other entry above
  // already uses — exercises the lazy arm of `SpellSource` instead of the
  // eager one, which is a better fit anyway.
  out.Recall = () => import('./spells/Recall').then(module => module.default(api));
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
