import { PackRegistry } from './PackRegistry';
import { installBundledPackData } from './install';

/**
 * The process's content, data half only — the one place a picker asks for a
 * roster, a spell's tooltip, or a map to offer, without ever building a
 * `ContentApi`.
 *
 * `contentRegistry()` (`./registry.ts`) is the other accessor, and both
 * return the *same* `PackRegistry` instance — `contentRegistry()` calls
 * `contentCatalog()` for it and then installs the code half on top, memoised
 * separately. Two accessors, one store: the split is about *when* the api is
 * built, not about two registries drifting apart the way the match-config
 * panel's setup screen and practice panel once did (see
 * `tests/game/config/matchConfigSource.contract.test.ts`, the test that
 * exists so that never happens again).
 *
 * Lazy for the same reason `registry.ts` always was: `src/main.ts` polyfills
 * the array prototypes and loads p5 before anything else runs, and a module
 * that does work at eval time runs before both. This file's own value
 * closure never reaches `ContentApi.ts` or anything under
 * `src/game/gameObject/` — `tests/content/contentApiChunk.test.ts` walks it
 * and fails if that stops being true — which is what lets `vite.config.ts`
 * pin it to the `pregame` chunk instead of dragging the whole engine surface
 * onto the menu's first paint.
 */
let registry: PackRegistry | null = null;

export function contentCatalog(): PackRegistry {
  if (registry) return registry;
  registry = new PackRegistry();
  installBundledPackData(registry);
  return registry;
}

/**
 * Test seam: forget the shared registry so the next read rebuilds it.
 *
 * Not exported for general use — `registry.ts`'s `resetContentRegistryForTests()`
 * is the one every test calls, since it has to reset this module's state
 * *and* its own "code installed" flag together, or the two accessors could
 * disagree about which registry instance is current.
 */
export function resetContentCatalogForTests(): void {
  registry = null;
}
