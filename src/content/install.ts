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
import riotCode, { data as riotData, BUNDLED_PACK_ID } from '../../packs/riot/pack';
import referenceCode, { data as referenceData } from '../../packs/reference/pack';
import { assetManifest as riotAssetManifest } from '../../packs/riot/generated/assetManifest';
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

export { BUNDLED_PACK_ID };

/**
 * Stage 1's loader, and the only file Stage 2 replaces.
 *
 * Here the factories are statically imported and the arrays are fixed. In
 * Stage 2 this becomes a fetch, an `import(blobUrl)` and a cache — and
 * nothing below it changes, because a pack is a factory taking core's API in
 * both cases:
 *
 *     Stage 1  import code from '@lol2d/content-riot'      -> code(api)
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
 * `riot` installs first: it is the game's own content, and install order is
 * how two packs answering the same question resolve, so the player gets the
 * answer they expect today. The reference pack follows to keep proving the
 * seam against a second, independent pack. `BUNDLED_PACK_DATA` and
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
 * which every kit's slot 0 names bare. `packs/riot/code.ts`/`data.ts` cannot
 * fold it in themselves: `tests/content/packBoundary.test.ts` refuses a pack
 * file any reach into `@/generated/spellCatalog`/`@/generated/spellModules`.
 * So this file does it instead, the one place already allowed to name both
 * the pack and core's own generated barrel: `riotDataWithCore`/
 * `riotCodeWithCore` below fold core's single `BasicAttack` entry onto what
 * `packs/riot/pack.ts` returns, core-last, before either half is installed —
 * `PackRegistry.installData`/`installCode` reject a second install under an
 * id already taken, so this has to happen once, before the call, not as a
 * second install under the same `riot` id.
 */

// Registers packs/riot's own generated manifest so `riot:<localKey>` — and,
// for a bare key no other pack claims, the unqualified key too (see
// `AssetManager.resolveDescriptor`'s own doc comment) — resolves against it.
// `?.` rather than a bare call: dozens of spell tests mock `AssetManager`
// down to `get`/`getAsset` and still exercise this module through
// `contentRegistry()` (`spellGroups()`, `loadEverySpellForTests()`), and none
// of them ever resolve a real riot-namespaced key — a no-op under those
// doubles is the correct behaviour, not a swallowed error. Idempotent
// (`Map.set`), so re-running it on a module re-evaluation is harmless. Moved
// here from `bundledPack.ts`: a pack file may not import `AssetManager`
// directly (`packBoundary.test.ts`), so this registration was never the
// pack's own to keep.
AssetManager.registerPackAssets?.(BUNDLED_PACK_ID, riotAssetManifest);

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
 * `packs/riot/data.ts`'s own `spellDisplay`, plus core's `BasicAttack` entry
 * — core-last, so a (today impossible) id collision resolves to core rather
 * than letting content shadow the one spell every kit presupposes.
 */
const riotDataWithCore: ContentPackData = {
  ...riotData,
  spellDisplay: { ...riotData.spellDisplay, ...coreSpellCatalog },
};

/**
 * `packs/riot/code.ts`'s own spells, plus core's `BasicAttack` class —
 * same core-last merge as `riotDataWithCore`, on the code half. Core's own
 * entries are already plain classes on `default` — no factory to call,
 * unlike every pack loader `riotCode(api)` already wraps.
 */
const riotCodeWithCore: ContentPackFactory = (api: ContentApi): ContentPackCode => {
  const code = riotCode(api);
  const spells: Record<string, SpellSource> = { ...code.spells };
  for (const [id, load] of Object.entries(coreSpellModules)) {
    spells[id] = () => load().then(module => module.default);
  }
  return { ...code, spells };
};

export const BUNDLED_PACK_DATA: ContentPackData[] = [riotDataWithCore, referenceData];
export const BUNDLED_PACKS: ContentPackFactory[] = [riotCodeWithCore, referenceCode];

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
