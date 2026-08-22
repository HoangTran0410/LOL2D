/**
 * How many source files `src/` holds, answered by something other than the
 * caller's own `readdirSync` recursion.
 *
 * Four scans in this suite walk `src/` themselves and then guard the walk with
 * a floor — `> 150`, `> 20`, `> 20`, `> 20` — so that a walk which silently
 * stopped descending could not pass by scanning nothing. Every one of those
 * numbers is a claim about how big `src/` was on the day it was typed, in a
 * repository whose whole programme is moving files out of `src/`: batch 4 took
 * 240 spell files out of it in one commit. A floor that survives a two-thirds
 * shrinkage is not measuring the thing its own comment says it is measuring.
 *
 * `import.meta.glob` is Vite's own walk of the same directory, resolved at
 * transform time out of the module graph rather than by anybody's
 * `readdirSync` — so "the recursion stopped descending" moves one side and not
 * the other, which is exactly the failure the floors were standing in for, and
 * the comparison is exact rather than approximate.
 *
 * `eager: false` (the default) means this is a map of *loaders*: nothing under
 * `src/` is imported, evaluated, or pulled into the test's module graph. Only
 * the key list is ever read.
 */
export function srcSourceFilePaths(): string[] {
  return Object.keys({
    ...import.meta.glob('../../src/**/*.ts'),
    ...import.meta.glob('../../src/**/*.vue'),
  });
}
