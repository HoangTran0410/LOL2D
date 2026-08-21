import type { ChampionAttackTuning } from '@/game/gameObject/attackableUnits/Champion';
import type { ContentApi } from './ContentApi';
import type {
  ChampionAttack,
  ChampionEntry,
  ContentPackCode,
  ContentPackData,
  SpellDisplayData,
  SpellSource,
} from './ContentPack';
import { CHAMPION_KITS } from '@/game/config/spellCatalog';
import { spellCatalog } from '@/generated/spellCatalog';
import { spellModules } from '@/generated/spellModules';

/**
 * The game's own content, wrapped as a pack without moving a file.
 *
 * **Scaffolding with a date on it.** Batch 4 moves `src/game/gameObject/spells/`
 * and `assets/` into `packs/riot/` and deletes this file; what survives is the
 * consumption path, which by then will have been the pack path for two batches.
 * That ordering is the whole point — a wiring defect and a move defect look
 * identical in a diff that does both at once.
 *
 * Nothing here is a copy. The roster is `CHAMPION_KITS`, the display data is
 * the generated catalogue, and the spells are the generated dynamic imports,
 * which is why the pack is lazy: 240 eager classes would put every spell in
 * the game into the chunk a match downloads first.
 *
 * Split the same way `packs/reference/pack.ts` is: `data` is a plain value,
 * computed eagerly here rather than deferred behind a factory, because
 * neither `championEntries()` nor `displayData()` ever touched the api (see
 * git blame — the old `bundled(_api)` factory's parameter was already
 * unused). `default` is the code half, still a factory, because
 * `ContentPackFactory`'s shape does not change per pack.
 */
export const BUNDLED_PACK_ID = 'riot';

// Assignable both ways, checked by the compiler and costing nothing at
// runtime. `ChampionAttack` is declared in the contract rather than imported
// from the engine so the contract file reads on its own; this is what keeps
// the two from drifting apart in silence.
const _attackShapesAgree: [ChampionAttack, ChampionAttackTuning] = [
  {} as ChampionAttackTuning,
  {} as ChampionAttack,
];
void _attackShapesAgree;

const spellSources = (): Record<string, SpellSource> => {
  const out: Record<string, SpellSource> = {};
  for (const [id, load] of Object.entries(spellModules)) {
    out[id] = () => load().then(module => module.default);
  }
  // Not in `spellModules`, on purpose: `Recall` is out of `spells/index.ts` so
  // that it can never reach the loadout picker, which is also why it gets no
  // `spellDisplay` entry below. `preset.ts` already imports it statically for
  // every match, so nothing here needs it loaded eagerly a second time — and
  // an eager import was a real static edge into the `game` chunk that this
  // module otherwise has no need for (`_api` above is unused; the rest of
  // this file only reads pregame-side data). A loader — the same shape
  // `spellModules`' entries already use — exercises the lazy arm of
  // `SpellSource` instead of the eager one, which is a better fit anyway:
  // this file has no *other* reason to reach into `src/game/gameObject/`.
  out.Recall = () => import('@/game/gameObject/spells/Recall').then(module => module.default);
  return out;
};

const displayData = (): Record<string, SpellDisplayData> => {
  const out: Record<string, SpellDisplayData> = {};
  for (const [id, entry] of Object.entries(spellCatalog)) {
    out[id] = {
      name: entry.name,
      description: entry.description,
      iconKey: entry.iconKey,
      coolDownMs: entry.coolDownMs,
      manaCost: entry.manaCost,
      specCoolDownMs: entry.specCoolDownMs,
    };
  }
  return out;
};

const championEntries = (): ChampionEntry[] => {
  const out: ChampionEntry[] = [];
  for (const kit of CHAMPION_KITS) {
    // `champ_` was the old test for "a real champion rather than a shelf of
    // loose abilities"; it becomes a declared field here and is never read as
    // a naming convention again.
    const playable =
      Boolean(kit.image?.startsWith('champ_')) && kit.spells.length === 4 && Boolean(kit.attack);
    out.push({
      id: kit.name,
      name: kit.name,
      image: kit.image,
      playable,
      attack: kit.attack,
      spells: [...kit.spells],
      recall: 'Recall',
    });
  }
  return out;
};

export const data: ContentPackData = {
  manifest: { id: BUNDLED_PACK_ID, version: '1.0.0', coreRange: '^1' },
  // Getters, not eagerly evaluated fields. `championEntries()`/`displayData()`
  // read `CHAMPION_KITS`/`spellCatalog` from `@/game/config/spellCatalog`,
  // which is itself part of the cycle this file sits in: `bundledPack.ts` ->
  // `spellCatalog.ts` (for `CHAMPION_KITS`) -> `catalog.ts` -> `install.ts`
  // -> `bundledPack.ts`. An eager field here reads `CHAMPION_KITS` at
  // whichever point *this* module happens to be reached mid-cycle — which
  // depends on which module a caller imports first, and is `undefined`
  // (`spellCatalog.ts` has not reached that declaration yet) whenever this
  // file is reached before it (`tests/scenes/pregameCatalog.test.ts` hit
  // exactly this: `CHAMPION_KITS is not iterable`). A getter defers the read
  // to whoever actually asks for the data — `PackRegistry.installData`,
  // called from inside a function body, always well after every module in
  // the cycle has finished loading — the same deferral the pre-split
  // `bundled(api)` factory got for free by never being *called* until
  // install time.
  get spellDisplay() {
    return displayData();
  },
  get champions() {
    return championEntries();
  },
};

const code = (_api: ContentApi): ContentPackCode => ({
  spells: spellSources(),
});

export default code;
