import { vi } from 'vitest';
import { fastHypot } from '../src/utils/optimized.utils';
import AssetManager from '../src/managers/AssetManager';
import { assetManifest as riotAssetManifest } from '../packs/riot/generated/assetManifest';

Math.hypot = fastHypot;

/**
 * Batch 4 task 4 moved 377 champion portraits, spell icons and monster art
 * files out of core's `assets/` into `packs/riot/assets/`, so `spell_flash`,
 * `champ_yasuo` and the rest are no longer keys `AssetManager`'s own
 * manifest knows — only a *registered* pack manifest does
 * (`registerPackAssets`, resolved by `AssetManager.resolveDescriptor`'s
 * install-order fallback). In the real app that registration is a side
 * effect of importing `src/content/bundledPack.ts`; a great many spell
 * tests construct a real spell class straight from `buildContentApi()` and
 * a pack factory (`makeFlash(buildContentApi())`, `stacks.test.ts` and
 * others) without ever touching `bundledPack.ts` or `contentRegistry()`, so
 * without this every one of those constructors threw "Unknown asset key"
 * the moment its `image = api.asset('spell_x')` field initializer ran.
 * One registration here, in the file every test file's environment already
 * runs before its own top-level code, covers every one of them — the same
 * shape `bundledPack.ts`'s own registration takes, just run once for the
 * whole suite instead of once per pack install.
 *
 * `?.` because dozens of test files `vi.mock('.../AssetManager', ...)` with
 * a bare `{ get, getAsset }` double that has no `registerPackAssets` at
 * all — hoisted mocks apply to this setup file's own import too, and a
 * no-op under one is correct: those doubles never resolve a real key.
 */
AssetManager.registerPackAssets?.('riot', riotAssetManifest);

Object.assign(globalThis, {
  deltaTime: 16,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  constrain: (n: number, low: number, high: number) => Math.min(high, Math.max(low, n)),
  random: (min = 1, max?: number) =>
    max === undefined ? Math.random() * min : min + Math.random() * (max - min),
  floor: Math.floor,
  createVector: vi.fn(),
});
