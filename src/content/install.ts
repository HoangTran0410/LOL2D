import type { ContentApi } from './ContentApi';
import type { ContentPackData, ContentPackFactory } from './ContentPack';
import type { PackRegistry } from './PackRegistry';
import bundledCode, { data as bundledData } from './bundledPack';
import referenceCode, { data as referenceData } from '../../packs/reference/pack';

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
 */
export const BUNDLED_PACK_DATA: ContentPackData[] = [bundledData, referenceData];
export const BUNDLED_PACKS: ContentPackFactory[] = [bundledCode, referenceCode];

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
