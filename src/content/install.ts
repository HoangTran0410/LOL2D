import { buildContentApi } from './ContentApi';
import type { ContentPackFactory } from './ContentPack';
import type { PackRegistry } from './PackRegistry';
import referencePack from '../../packs/reference/pack';

/**
 * Stage 1's loader, and the only file Stage 2 replaces.
 *
 * Here the factories are statically imported and the array is fixed. In Stage
 * 2 this becomes a fetch, an `import(blobUrl)` and a cache — and nothing below
 * it changes, because a pack is a factory taking core's API in both cases:
 *
 *     Stage 1  import factory from '@lol2d/content-riot'      -> factory(api)
 *     Stage 2  const { default: factory } = await import(url) -> factory(api)
 *
 * Keeping that one seam is what makes Stage 2 a change to this file rather
 * than a rewrite of every pack.
 */
export const BUNDLED_PACKS: ContentPackFactory[] = [referencePack];

/** Every pack gets the same api object, so there is one core in the process. */
export function installBundledPacks(registry: PackRegistry): void {
  const api = buildContentApi();
  for (const factory of BUNDLED_PACKS) {
    registry.install(factory(api));
  }
}
