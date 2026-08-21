import type { ChampionAttackTuning } from '@/game/gameObject/attackableUnits/Champion';
import type { ContentApi } from './ContentApi';
import type {
  ChampionAttack,
  ChampionEntry,
  ContentPackCode,
  ContentPackData,
  MonsterDef,
  SpellDisplayData,
  SpellSource,
} from './ContentPack';
import { CHAMPION_KITS } from '@/game/config/spellCatalog';
// Relative, not `@/…`: batch 4 task 3 moved the spells (and their generated
// catalogue) into `packs/riot/generated/`. Core's own `@/generated/spellCatalog`
// now holds only `BasicAttack` — see that file's own header.
import { spellCatalog } from '../../packs/riot/generated/spellCatalog';
import { spellModules } from '../../packs/riot/generated/spellModules';
// `BasicAttack` is core's own generated entry (`coreSpells/index.ts`'s own
// header: "the last-resort fallback... must not itself be something that
// might not have arrived"), and `CHAMPION_KITS`' "Đánh Thường" shelf and
// slot 0 of every kit still name it as a bare id, unqualified from the
// riot pack's own — merged in below with core spread last, so a (today
// impossible) id collision resolves to core rather than letting content
// shadow the one spell every kit presupposes. `bundledPack.ts` dies with
// the rest of this bridge in Task 7.
import { spellCatalog as coreSpellCatalog } from '@/generated/spellCatalog';
import { spellModules as coreSpellModules } from '@/generated/spellModules';
// Batch 4 task 4: 378 files (champion portraits, spell icons, monster art)
// moved out of core's own `assets/` into `packs/riot/assets/`. This is the
// one place that manifest is imported — `src/` may not reach `packs/`
// outside the named exceptions (`corePacksBoundary.test.ts`), and this file
// is one of them — and it is registered with `AssetManager` below so
// `riot:<localKey>` resolves against it. See `PackManifest.assets`'s own
// doc comment for why the manifest.assets string and this import travel
// together rather than either alone.
import { assetManifest as riotAssetManifest } from '../../packs/riot/generated/assetManifest';
import AssetManager from '@/managers/AssetManager';
import { summonersRift } from './maps/summonersRift';
// `Baron.ts` moved into `packs/riot/monsters/` (Task 2 of the content-pack
// extraction). This file's own header explains why reaching for it here is
// fine: it is scaffolding wrapping content that has not finished moving into
// `packs/riot/` yet, not core. `preset.ts` — real core — does not reach this
// file directly; see `monsterBodyPreset`'s own doc comment for how it gets
// Baron's abilities instead.
import makeBaronAbilities from '../../packs/riot/monsters/Baron';

/**
 * The game's own content, wrapped as a pack without moving a file.
 *
 * **Scaffolding with a date on it.** Batch 4 moves `src/game/gameObject/spells/`
 * and `assets/` into `packs/riot/` and deletes this file; what survives is the
 * consumption path, which by then will have been the pack path for two batches.
 * That ordering is the whole point — a wiring defect and a move defect look
 * identical in a diff that does both at once. Task 2 already moved the three
 * files under this content whose names were Riot's own
 * (`LuxBeamEffect`/`DariusAxe` into `packs/riot/vfx/`, `Baron.ts` into
 * `packs/riot/monsters/`) — first, at a scale where a mistake would be
 * obvious — which is why `monsterEntries()` below reads a comment pointing at
 * a pack file already, ahead of the 240-spell move still to come.
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

// Registers packs/riot's own generated manifest so `riot:<localKey>` — and,
// for a bare key no other pack claims, the unqualified key too (see
// `AssetManager.resolveDescriptor`'s own doc comment) — resolves against it.
// `?.` rather than a bare call: dozens of spell tests mock `AssetManager`
// down to `get`/`getAsset` and still exercise this module through
// `contentRegistry()` (`spellGroups()`, `loadEverySpellForTests()`), and none
// of them ever resolve a real riot-namespaced key — a no-op under those
// doubles is the correct behaviour, not a swallowed error. Idempotent
// (`Map.set`), so re-running it on a module re-evaluation is harmless.
AssetManager.registerPackAssets?.(BUNDLED_PACK_ID, riotAssetManifest);

// Assignable both ways, checked by the compiler and costing nothing at
// runtime. `ChampionAttack` is declared in the contract rather than imported
// from the engine so the contract file reads on its own; this is what keeps
// the two from drifting apart in silence.
const _attackShapesAgree: [ChampionAttack, ChampionAttackTuning] = [
  {} as ChampionAttackTuning,
  {} as ChampionAttack,
];
void _attackShapesAgree;

const spellSources = (api: ContentApi): Record<string, SpellSource> => {
  const out: Record<string, SpellSource> = {};
  // Every pack spell module's `default` is now `(api: ContentApi) => SpellClass`
  // (batch 4 task 3) — the loader resolves the module *and* calls the factory,
  // so whatever `PackRegistry` gets back is still a plain constructible class.
  for (const [id, load] of Object.entries(spellModules)) {
    out[id] = () => load().then(module => module.default(api));
  }
  // Not in `spellModules`, on purpose: `Recall` is out of `spells/index.ts` so
  // that it can never reach the loadout picker, which is also why it gets no
  // `spellDisplay` entry below. `preset.ts` reaches it directly and
  // synchronously for every match (`attachRecall`, a named, pinned exception —
  // see `tests/content/coreSpells.test.ts`), so nothing here needs it loaded
  // eagerly a second time. A loader — the same shape `spellModules`' entries
  // already use — exercises the lazy arm of `SpellSource` instead of the
  // eager one, which is a better fit anyway: this file has no *other* reason
  // to reach into `packs/riot/spells/` outside the generated barrel above.
  out.Recall = () =>
    import('../../packs/riot/spells/Recall').then(module => module.default(api));
  // Core's own entries (`BasicAttack`) are already plain classes on `default`
  // — no factory to call, unlike every riot-pack loader above.
  for (const [id, load] of Object.entries(coreSpellModules)) {
    out[id] = () => load().then(module => module.default);
  }
  return out;
};

const displayData = (): Record<string, SpellDisplayData> => {
  const out: Record<string, SpellDisplayData> = {};
  for (const [id, entry] of Object.entries({ ...spellCatalog, ...coreSpellCatalog })) {
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

/**
 * The jungle, as monster identities — six of them, matching Task 7's split:
 * the epic camp, the two buff camps, wolves, gromp, raptors. Where each one
 * stands is `mapPresets.ts`'s `NEUTRAL_SLOTS`, read through
 * `summonersRiftGeometry.ts`'s `slots.neutral`; a `role` here and a `role`
 * there is the only thing tying a camp's identity to its place, and
 * `PackRegistry.monstersFilling` is the match.
 *
 * No `CHAMPION_KITS`/`spellCatalog` reads, so — unlike `champions`/`spellDisplay`
 * above — this needs no getter to dodge the module's own load-order cycle;
 * it is safe to build once, eagerly.
 *
 * **A camp is a composition, not N copies of one body.** `wolves.members`
 * and `raptors.members` are a Greater Wolf/Crimson Raptor plus its smaller
 * pack-mates, each with its own avatar, size and health — every number below
 * is copied from the pre-Task-7 `MonsterPreset` table (`git show
 * f2092e4:src/game/mapPresets.ts`), not retuned. `offset` is that same
 * source's per-body `camp: {x, y}` minus its group's anchor position
 * (`wolf1`'s own camp for the wolves offsets, `raptor1`'s for the raptors) —
 * see `tests/game/preset.mapSlots.test.ts`'s "recovers the original preset
 * entries" test, which checks `slot + offset === original camp` against that
 * same historical table.
 *
 * `wolves` and `raptors` each fill **two** neutral slots (Summoner's Rift
 * has a wolf pit and a raptor pit on both sides), but there is only one
 * `MonsterDef` of each — its `members`/`offset` layout is reused at both
 * slots. That is a real, disclosed loss of fidelity: the original data
 * placed the second pit's small bodies at slightly different offsets from
 * its own anchor than the first pit's. It is not a loss of *tuning* — the
 * second pit's bodies had byte-identical avatar/speed/size/attackRange/
 * reviveTime/health to the first's in the original table (verified, not
 * assumed) — only of the incidental few-dozen-pixel arrangement within the
 * pit, which one shared `MonsterDef` cannot carry two different versions of.
 */
const monsterEntries = (): Record<string, MonsterDef> => ({
  baron: {
    id: 'baron',
    name: 'Baron',
    fills: ['baron'],
    members: [
      {
        name: 'Baron',
        avatar: 'monster_Baron_Nashor',
        speed: 0,
        size: 100,
        attackRange: 400,
        reviveTime: 3000,
        health: 1000,
        // Rooted with a long reach. The bite is small because it is the one
        // part of the fight nobody can dodge — the rest of Baron's kit lives
        // in `packs/riot/monsters/Baron.ts`'s `makeBaronAbilities` (wired
        // below, in `code`, and merged onto the preset by `preset.ts`'s
        // `monsterBodyPreset`, which this data-only definition cannot
        // carry) and is all avoidable.
        damage: 12,
        attackInterval: 2000,
        aggroRange: 480,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    fills: ['blue'],
    members: [
      {
        name: 'Blue',
        avatar: 'monster_Blue_Sentinel',
        speed: 2,
        size: 80,
        attackRange: 50,
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  red: {
    id: 'red',
    name: 'Red',
    fills: ['red'],
    members: [
      {
        name: 'Red',
        avatar: 'monster_Red_Brambleback',
        speed: 2,
        size: 80,
        attackRange: 50,
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  // Anchor: wolf1 at (1685, 3562). wolf1_a (1602, 3511) -> offset (-83, -51).
  // wolf1_b (1725, 3659) -> offset (40, 97). Total health 300 + 100 + 100 = 500.
  wolves: {
    id: 'wolves',
    name: 'Wolves',
    fills: ['wolves'],
    members: [
      {
        name: 'Greater Wolf',
        avatar: 'monster_Greater_Murk_Wolf',
        speed: 2,
        size: 70,
        attackRange: 50,
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
      {
        name: 'Wolf',
        avatar: 'monster_Murk_Wolf',
        speed: 2.5,
        size: 40,
        attackRange: 50,
        reviveTime: 3000,
        health: 100,
        offset: { x: -83, y: -51 },
      },
      {
        name: 'Wolf',
        avatar: 'monster_Murk_Wolf',
        speed: 2.5,
        size: 40,
        attackRange: 50,
        reviveTime: 3000,
        health: 100,
        offset: { x: 40, y: 97 },
      },
    ],
  },
  gromp: {
    id: 'gromp',
    name: 'Gromp',
    fills: ['gromp'],
    members: [
      {
        name: 'Gromp',
        avatar: 'monster_Gromp',
        speed: 2,
        size: 70,
        attackRange: 150,
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
    ],
  },
  // Anchor: raptor1 at (2954, 4110). raptor1_a (3045, 4026) -> offset (91, -84).
  // raptor1_b (3149, 4095) -> offset (195, -15). raptor1_c (3060, 4169) ->
  // offset (106, 59). Total health 300 + 50 + 50 + 50 = 450.
  raptors: {
    id: 'raptors',
    name: 'Raptors',
    fills: ['raptors'],
    members: [
      {
        name: 'Crimson Raptor',
        avatar: 'monster_Crimson_Raptor',
        speed: 2,
        size: 70,
        attackRange: 150,
        reviveTime: 3000,
        health: 300,
        offset: { x: 0, y: 0 },
      },
      {
        name: 'Raptor',
        avatar: 'monster_Raptor',
        speed: 2,
        size: 40,
        attackRange: 150,
        reviveTime: 3000,
        health: 50,
        offset: { x: 91, y: -84 },
      },
      {
        name: 'Raptor',
        avatar: 'monster_Raptor',
        speed: 2,
        size: 40,
        attackRange: 150,
        reviveTime: 3000,
        health: 50,
        offset: { x: 195, y: -15 },
      },
      {
        name: 'Raptor',
        avatar: 'monster_Raptor',
        speed: 2,
        size: 40,
        attackRange: 150,
        reviveTime: 3000,
        health: 50,
        offset: { x: 106, y: 59 },
      },
    ],
  },
});

export const data: ContentPackData = {
  manifest: { id: BUNDLED_PACK_ID, version: '1.0.0', coreRange: '^1', assets: BUNDLED_PACK_ID },
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
  // Plain, not a getter: `monsterEntries()` has no `CHAMPION_KITS`/`spellCatalog`
  // read to race, so there is no load-order cycle to defer past. Built once.
  monsters: monsterEntries(),
  // A getter for consistency with `champions`/`spellDisplay` above, though
  // Task 4's split removed the cycle risk this one used to carry: before it,
  // `./maps/summonersRift` built its `terrain`/`slots` eagerly from
  // `@/game/mapPresets` and `@/game/lanes`, and reading that binding at the
  // wrong point in `CHAMPION_KITS`'s own import cycle could observe it
  // mid-load. Now `summonersRift.ts` has no value imports at all — its
  // geometry sits behind `() => import('./summonersRiftGeometry')`, which
  // does not run until something calls it — so there is nothing left for
  // eager field access here to race.
  get maps() {
    return [summonersRift];
  },
};

const code = (api: ContentApi): ContentPackCode => ({
  spells: spellSources(api),
  // The one place `api` is actually used in this file — every other section
  // (`championEntries`, `displayData`, `monsterEntries`) is pure data and
  // never touches it. Baron is the only monster with a code half today.
  monsterAbilities: {
    baron: makeBaronAbilities(api),
  },
});

export default code;
