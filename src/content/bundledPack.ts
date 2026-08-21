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
import { spellCatalog } from '@/generated/spellCatalog';
import { spellModules } from '@/generated/spellModules';
import { summonersRift } from './maps/summonersRift';

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
 * A pack of several (`wolves`, `raptors`) is one definition with `count`
 * rather than one entry per body — `Game.spawnJungle()` spawns that many and
 * gives every one of them the same camp point, which is what lets
 * `Monster.alertCamp` find packmates without the `campId` string this
 * replaces. Collapsing "Greater Wolf" + two "Wolf"s (or the raptor
 * equivalent) into one shared identity is a real simplification — a pack
 * pack's members are no longer visually distinct — traded for a monster
 * being pure data instead of position-tagged code; nothing here changes camp
 * *positions*, health totals or attack tuning per body.
 */
const monsterEntries = (): Record<string, MonsterDef> => ({
  baron: {
    id: 'baron',
    name: 'Baron',
    fills: ['baron'],
    avatar: 'monster_Baron_Nashor',
    speed: 0,
    size: 100,
    attackRange: 400,
    reviveTime: 3000,
    health: 1000,
    // Rooted with a long reach. The bite is small because it is the one part
    // of the fight nobody can dodge — the rest of Baron's kit lives in
    // `BARON_ABILITIES` (merged in by `preset.ts`'s `monsterPresetFromSlot`,
    // which this data-only definition cannot carry) and is all avoidable.
    damage: 12,
    attackInterval: 2000,
    aggroRange: 480,
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    fills: ['blue'],
    avatar: 'monster_Blue_Sentinel',
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  red: {
    id: 'red',
    name: 'Red',
    fills: ['red'],
    avatar: 'monster_Red_Brambleback',
    speed: 2,
    size: 80,
    attackRange: 50,
    reviveTime: 3000,
    health: 300,
  },
  wolves: {
    id: 'wolves',
    name: 'Wolf',
    fills: ['wolves'],
    avatar: 'monster_Murk_Wolf',
    speed: 2.5,
    size: 40,
    attackRange: 50,
    reviveTime: 3000,
    health: 100,
    count: 3,
  },
  gromp: {
    id: 'gromp',
    name: 'Gromp',
    fills: ['gromp'],
    avatar: 'monster_Gromp',
    speed: 2,
    size: 70,
    attackRange: 150,
    reviveTime: 3000,
    health: 300,
  },
  raptors: {
    id: 'raptors',
    name: 'Raptor',
    fills: ['raptors'],
    avatar: 'monster_Raptor',
    speed: 2,
    size: 40,
    attackRange: 150,
    reviveTime: 3000,
    health: 50,
    count: 4,
  },
});

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

const code = (_api: ContentApi): ContentPackCode => ({
  spells: spellSources(),
});

export default code;
