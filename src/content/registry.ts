import { PackRegistry } from './PackRegistry';
import { installBundledPacks } from './install';

/**
 * The process's content, and the one place anything asks for it.
 *
 * Lazy rather than installed at import time, for the reason every other module
 * in this codebase is: `src/main.ts` polyfills the array prototypes and loads
 * p5 before anything else runs, and a module that does work at eval time runs
 * before both.
 *
 * In the running game the first read is `main.ts`'s own warm call, the first
 * statement of `setup()` — so installation happens during the loading screen,
 * not on the pregame screen's first paint. Laziness is not what schedules it
 * there; the warm call is. What laziness buys is that a **test** pays for the
 * install only if it asks, and that no import order can make this run too early.
 */
let registry: PackRegistry | null = null;

export function contentRegistry(): PackRegistry {
  if (registry) return registry;
  registry = new PackRegistry();
  installBundledPacks(registry);
  return registry;
}

/**
 * Forget the registry, so the next read builds and installs a fresh one.
 *
 * Discards the instance rather than calling `PackRegistry.reset()` on it: a
 * test that has already captured the old registry keeps a coherent object
 * instead of one silently emptied under it, and nothing outside this module
 * holds the reference, so the orphan is collected.
 */
export function resetContentRegistryForTests(): void {
  registry = null;
}
