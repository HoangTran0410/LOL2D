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
 * A **leaf on purpose**: nothing imported here but `AssetManager`. Three
 * call sites need this crossing — `spellCatalog.ts` (the pregame roster's
 * own art), `ContentApi.asset` (what a pack's spell code can resolve), and
 * `Champion`'s preset-avatar resolution (a live champion's portrait) — and
 * the last two cannot reach each other: `Champion.ts` importing anything
 * that chains into `ContentApi.ts` recreates a real cycle, because
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
 */
export const packAsset = (key: string): AssetHandle => AssetManager.get(key as never);
