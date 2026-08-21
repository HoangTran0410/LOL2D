import AssetManager, { type AssetHandle } from '@/managers/AssetManager';

/**
 * A pack's own asset key, resolved to a handle.
 *
 * Core keeps a generated `AssetKey` union for its own art; a pack declares
 * its icon/portrait keys in its own manifest and type-checks them against
 * its own generated union instead. `AssetManager.get` is typed against
 * core's union, so crossing that boundary needs a cast — `key as never` —
 * and this is that cast's one home.
 *
 * A **leaf on purpose**: nothing imported here but `AssetManager`. Four
 * call sites need this crossing — `spellCatalog.ts` (the pregame roster's
 * own art), `ContentApi.asset` (what a pack's spell code can resolve),
 * `Champion`'s preset-avatar resolution (a live champion's portrait), and
 * `GameScene.matchArtKeys`/`startGame` (a running match's preload list) —
 * and the middle two cannot reach each other: `Champion.ts` importing
 * anything that chains into `ContentApi.ts` recreates a real cycle, because
 * `ContentApi.ts` imports `Champion` and `Pet` as *values* —
 * `Champion.ts -> spellCatalog.ts -> registry.ts -> install.ts ->
 * ContentApi.ts -> Champion.ts` — which fails 88 test files with `Class
 * extends value undefined` (`Pet extends Champion` seeing `Champion` as
 * `undefined` mid-initialisation). A module with no imports of its own
 * closes that cycle structurally: every side can import *this*, and this
 * imports nothing that reaches back.
 *
 * `vite.config.ts`'s `manualChunks` pins this file to its own `shared`
 * chunk rather than letting it fall into either the `pregame` carve-out
 * (`src/game/config/`) or `game` (`src/content/`) — it is read from both.
 *
 * Still a bare passthrough after batch 4 task 4 gave a pack its own asset
 * tree: the qualification a multi-pack namespace needs (`<packId>:<localKey>`,
 * `AssetManager.registerPackAssets`/`resolveDescriptor`) lives entirely on
 * the other side of `AssetManager.get`, either baked into the string by
 * `PackRegistry.writeData` (every `image`/`avatar`/`iconKey` this crossing
 * ever sees) or resolved by install order for a bare key nothing qualified
 * (every existing `packs/riot/spells/*.ts` call). This leaf never had to
 * learn which pack it is being asked about.
 */
export const packAsset = (key: string): AssetHandle => AssetManager.get(key as never);

/**
 * Same crossing as `packAsset` above, for the one caller that needs the
 * asset *loaded* rather than merely looked up: `GameScene.startGame`'s
 * match-art preload. Its key list is built from a plan's kit avatars and
 * spell icons — a pack's own strings now that a pack champion can be
 * playable — so it can no longer be cast back to core's `AssetKey` union at
 * the call site; this is where that cast lives instead.
 */
export const ensurePackAsset = (key: string): Promise<AssetHandle> =>
  AssetManager.ensure(key as never);
