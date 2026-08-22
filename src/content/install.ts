import type { ContentApi } from './ContentApi';
import type {
  ChampionAttack,
  ContentPackCode,
  ContentPackData,
  ContentPackFactory,
  SpellSource,
} from './ContentPack';
import type { PackRegistry } from './PackRegistry';
import type { ChampionAttackTuning } from '@/game/gameObject/attackableUnits/Champion';
import AssetManager from '@/managers/AssetManager';
// **Every optional pack arrives through this one generated barrel**, and the
// barrel names each one by *package* name (`@moba2d/content-riot`), never by
// relative path — which is the whole of content-pack-extraction batch 5 task
// 8.
//
// This file used to import `../../packs/riot/pack` directly, and the previous
// version of this comment said so at length: `tsconfig.json`'s
// `include: ["src/**/*"]` follows imports, so `typecheck` compiled
// `packs/riot`, `vite build` bundled it, and moving `packs/` aside stopped
// `verify` dead on this line with `error TS2307: Cannot find module
// '../../packs/riot/pack'`. That was measured, not predicted, and it meant
// core could not be built without the pack at all — the one claim the whole
// extraction rests on.
//
// A relative path is also a path that resolves to *nothing* the day the pack
// is a repository of its own and `npm install` puts it under `node_modules/`.
// `src/generated/installedPacks.ts` is generated from what is actually
// installed (`scripts/generate-installed-packs.mjs`, run by `predev`,
// `prebuild` and checked by `verify`), so with the pack gone the barrel is
// simply an empty array and this module still compiles, still boots, and
// installs the reference pack alone. `npm run verify:without-packs` is the
// drill that proves it, end to end, in one command.
//
// The barrel rather than a dynamic import because **this file's shape is
// load-bearing**: it is spec §9.1's Stage 1 loader, `spellRegistry.ts` reads
// `BUNDLED_PACK_ID` from it at module scope, and `Game` builds a match plan
// synchronously. Nothing in ESM makes a *static* import conditional; what can
// be conditional is the generated list of them. Same idiom as
// `src/generated/assetManifest.ts` and `spellCatalog.ts`.
import { installedPacks } from '@/generated/installedPacks';
// **The reference pack is not optional and stays a plain import.** It is
// core's own content — one champion, four spells, one map — and it is what
// makes core a complete game standing alone rather than a menu. It never
// leaves this repository, so it is never absent, so there is nothing for the
// barrel to decide about it.
import referenceCode, { data as referenceData } from '../../packs/reference/pack';
// Core's own generated barrels — one entry each (`BasicAttack`) since batch 4
// task 3 moved the other 237 into `packs/riot/generated/`.
// `tests/content/rosterSource.test.ts` bans reading these two specifiers
// outside a named allow-list, now exactly this file: this is the one place
// core's own generated spell is folded into the installed pack (see this
// file's own header, "packs/riot/pack.ts is a real pack now"), the same
// permanent role `content/install.ts` already carries in
// `corePacksBoundary.test.ts`'s exemption list for the same reason.
import { spellCatalog as coreSpellCatalog } from '@/generated/spellCatalog';
import { spellModules as coreSpellModules } from '@/generated/spellModules';

/**
 * Stage 1's loader, and the only file Stage 2 replaces.
 *
 * Here the factories are statically imported and the arrays are fixed. In
 * Stage 2 this becomes a fetch, an `import(blobUrl)` and a cache — and
 * nothing below it changes, because a pack is a factory taking core's API in
 * both cases:
 *
 *     Stage 1  import code from '@moba2d/content-riot'     -> code(api)
 *     Stage 2  const { default: code } = await import(url) -> code(api)
 *
 * Keeping that one seam is what makes Stage 2 a change to this file rather
 * than a rewrite of every pack.
 *
 * **Deliberately no value import of `./ContentApi` here** — only the `type`
 * one above, which the toolchain erases. `buildContentApi()` used to be
 * called in this module, which meant importing *anything* from `install.ts`
 * — even just `BUNDLED_PACK_DATA` — pulled `ContentApi.ts`'s own ~80-module
 * engine surface into the importer's value closure, whether or not the api
 * was ever built. `src/content/catalog.ts` needs `installBundledPackData`
 * from here and must not reach the engine (`tests/content/contentApiChunk.test.ts`),
 * so the api is built by the caller instead — `registry.ts`'s
 * `contentRegistry()` — and handed to `installBundledPackCode` as a plain
 * argument.
 *
 * The optional packs install first: `riot` is the game's own content, and
 * install order is how two packs answering the same question resolve, so the
 * player gets the answer they expect today. The reference pack follows to
 * keep proving the seam against a second, independent pack — and, when no
 * optional pack is installed at all, to be the whole game on its own.
 * `BUNDLED_PACK_DATA` and
 * `BUNDLED_PACKS` are parallel arrays — index `i` of one is the data half of
 * index `i` of the other's code — because `installBundledPackCode` needs
 * each factory's pack id before it has anything the factory returned yet.
 *
 * **`packs/riot/pack.ts` is a real pack now, not `bundledPack.ts`'s
 * adapter** (batch 4 task 7 — that file's own header called it "scaffolding
 * with a date on it" since batch 2). One difference survives the move: a
 * bare, unqualified spell id has always meant "the bundled pack's own"
 * (`spellRegistry.ts`'s `qualifySpellId`, reading `BUNDLED_PACK_ID` from
 * here), and that has to include `BasicAttack` — core's own fallback spell,
 * which every kit's slot 0 names bare — and, since batch 5 task 1, `Recall`:
 * `packs/riot/data.ts`'s `championEntries()` still names every champion's
 * way home as the bare string `'Recall'`. `packs/riot/code.ts`/`data.ts`
 * cannot fold either in themselves: the `pack-core-boundary` seam
 * refuses a pack file any reach into `@/generated/spellCatalog`/
 * `@/generated/spellModules`/`@/game/gameObject/coreSpells/Recall`. So this
 * file does it instead, the one place already allowed to name both the pack
 * and core's own spells: `withCoreSpells` below folds core's `BasicAttack`
 * entry (plus, on the code half only, `Recall` — it carries no display data,
 * so there is nothing to fold onto the data half) onto what the first
 * installed pack returns, core-last, before either half is installed —
 * `PackRegistry.installData`/`installCode` reject a second install under an
 * id already taken, so this has to happen once, before the call, not as a
 * second install under the same id.
 *
 * **"The first installed pack", not "riot".** Which pack owns bare ids is a
 * consequence of install order, not a name written down twice — with the riot
 * pack absent the reference pack is first and `BUNDLED_PACK_ID` is
 * `'reference'`, and `BasicAttack`/`Recall` fold onto it instead, because a
 * kit with no basic attack and no way home is not a playable game. There is
 * always a first pack: the reference pack cannot be uninstalled.
 */

/**
 * One installed pack, as this file consumes it: the two halves plus the id
 * they are installed under. The optional ones come from the generated barrel;
 * the reference pack is built here from its own plain import.
 */
interface BundledPack {
  id: string;
  data: ContentPackData;
  code: ContentPackFactory;
}

// Registers each installed pack's own generated manifest so `<packId>:<localKey>`
// — and, for a bare key no other pack claims, the unqualified key too (see
// `AssetManager.resolveDescriptor`'s own doc comment) — resolves against it.
// The reference pack is not in this loop: its five images live in *core's*
// own `assets/images/reference/` and are already in core's generated manifest,
// so it has no pack manifest of its own to register.
//
// `?.` rather than a bare call: dozens of spell tests mock `AssetManager`
// down to `get`/`getAsset` and still exercise this module through
// `contentRegistry()` (`spellGroups()`, `loadEverySpellForTests()`), and none
// of them ever resolve a real riot-namespaced key — a no-op under those
// doubles is the correct behaviour, not a swallowed error. Idempotent
// (`Map.set`), so re-running it on a module re-evaluation is harmless. Moved
// here from `bundledPack.ts`: a pack file may not import `AssetManager`
// directly (the `pack-core-boundary` seam), so this registration was never the
// pack's own to keep.
for (const pack of installedPacks) {
  AssetManager.registerPackAssets?.(pack.id, pack.assetManifest);
}

/**
 * Install order: every optional pack the barrel found, then the reference
 * pack. Never empty — the reference pack is always here — which is what lets
 * `BUNDLED_PACK_ID` and the core-spell fold below index `[0]` without a
 * guard.
 */
const packsInInstallOrder: BundledPack[] = [
  ...installedPacks.map(pack => ({ id: pack.id, data: pack.data, code: pack.code })),
  { id: referenceData.manifest.id, data: referenceData, code: referenceCode },
];

/**
 * The pack a bare, unqualified spell id resolves against — `spellRegistry.ts`'s
 * `qualifySpellId`. `'riot'` in any build that has the riot pack, which is
 * every shipped one; `'reference'` in a core-only checkout.
 */
export const BUNDLED_PACK_ID: string = packsInInstallOrder[0].id;

// Assignable both ways, checked by the compiler and costing nothing at
// runtime. `ChampionAttack` (`./ContentPack`) is declared in the contract
// rather than imported from the engine so the contract file reads on its
// own; this is what keeps the two from drifting apart in silence. Moved
// here from `bundledPack.ts` for the same reason as the registration above:
// `ChampionAttackTuning` is an engine type a pack file may not name.
const _attackShapesAgree: [ChampionAttack, ChampionAttackTuning] = [
  {} as ChampionAttackTuning,
  {} as ChampionAttack,
];
void _attackShapesAgree;

/**
 * The bundled pack's own `spellDisplay`, plus core's `BasicAttack` entry —
 * core-last, so a (today impossible) id collision resolves to core rather
 * than letting content shadow the one spell every kit presupposes.
 */
const dataWithCoreSpells = (data: ContentPackData): ContentPackData => ({
  ...data,
  spellDisplay: { ...data.spellDisplay, ...coreSpellCatalog },
});

/**
 * The bundled pack's own spells, plus core's `BasicAttack` class and `Recall`
 * factory — same core-last merge as `dataWithCoreSpells`, on the code half.
 * `BasicAttack`'s entries are already plain classes on `default` — no factory
 * to call, unlike every pack loader `code(api)` already wraps. `Recall` is the
 * opposite of both: not in `coreSpellModules` at all (see
 * `coreSpells/index.ts`'s own header for why it is deliberately not
 * catalogued there), and still a factory rather than a plain class — see
 * `preset.ts`'s own import comment for why — so it is folded on by hand.
 *
 * Reached with a *dynamic* `import()`, deliberately, not the static import
 * every other symbol in this file uses: this module (`src/content/`) is
 * chunked `pregame`, and `coreSpells/Recall.ts` falls to the blanket
 * `/src/game/` rule in `vite.config.ts` and lands in `game` — a *static*
 * value import here would open exactly the `pregame -> game` edge that
 * chunk's own header calls out as the regression the whole split exists to
 * prevent. A dynamic import is the sanctioned way across that boundary
 * (`scripts/check-chunks.mjs` only ever flags a *static* one) and is the
 * same shape `packs/riot/code.ts`'s own `Recall` entry used before batch 5
 * task 1 moved the file — a lazy loader is a better fit than an eager
 * resolve anyway, since nothing here calls this path outside a test or a
 * pack composed and installed on its own.
 */
const codeWithCoreSpells =
  (factory: ContentPackFactory): ContentPackFactory =>
  (api: ContentApi): ContentPackCode => {
    const code = factory(api);
    const spells: Record<string, SpellSource> = { ...code.spells };
    for (const [id, load] of Object.entries(coreSpellModules)) {
      spells[id] = () => load().then(module => module.default);
    }
    spells.Recall = () =>
      import('@/game/gameObject/coreSpells/Recall').then(module => module.default(api));
    return { ...code, spells };
  };

export const BUNDLED_PACK_DATA: ContentPackData[] = packsInInstallOrder.map((pack, index) =>
  index === 0 ? dataWithCoreSpells(pack.data) : pack.data
);
export const BUNDLED_PACKS: ContentPackFactory[] = packsInInstallOrder.map((pack, index) =>
  index === 0 ? codeWithCoreSpells(pack.code) : pack.code
);

if (BUNDLED_PACK_DATA.length !== BUNDLED_PACKS.length) {
  // A pack added to one array and not the other silently misaligns every
  // index after it — `installBundledPackCode` would install one pack's code
  // against a different pack's id. Named here, at load, rather than
  // discovered as a mismatched champion roster later.
  throw new Error('BUNDLED_PACK_DATA and BUNDLED_PACKS must stay the same length, in pack order');
}

/** Every bundled pack's data half, installed — no `ContentApi` involved. */
export function installBundledPackData(registry: PackRegistry): void {
  for (const data of BUNDLED_PACK_DATA) {
    registry.installData(data);
  }
}

/**
 * Every bundled pack's code half, installed against the data `installBundledPackData`
 * already wrote. `api` is built once by the caller and handed to every
 * factory unchanged, so there is one core in the process — see
 * `ContentPack.ts`'s header for why two would be a real bug, not a style
 * preference.
 */
export function installBundledPackCode(registry: PackRegistry, api: ContentApi): void {
  for (let i = 0; i < BUNDLED_PACKS.length; i++) {
    registry.installCode(BUNDLED_PACK_DATA[i].manifest.id, BUNDLED_PACKS[i](api));
  }
}
