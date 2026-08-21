import { PackRegistry } from './PackRegistry';
import { installBundledPacks } from './install';

/**
 * The process's content, and the one place anything asks for it.
 *
 * Lazy rather than installed at import time, for the reason every other module
 * in this codebase is: `src/main.ts` polyfills the array prototypes and loads
 * p5 before anything else runs, and a module that does work at eval time runs
 * before both. It is installed on the first read instead, which in a match is
 * the pregame screen and in a test is whatever the test asks for.
 */
let registry: PackRegistry | null = null;

export function contentRegistry(): PackRegistry {
  if (registry) return registry;
  registry = new PackRegistry();
  installBundledPacks(registry);
  return registry;
}

export function resetContentRegistryForTests(): void {
  registry = null;
}
