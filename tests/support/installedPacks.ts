import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * content-pack-extraction batch 5 task 7: a scan that names a specific
 * pack's directory (`packs/riot/spells`, `packs/riot/monsters`, ...) has to
 * answer two different questions about it, and conflating them is exactly
 * how a scan goes quiet forever. Task 8 deliberately moves `packs/riot/`
 * out of this tree and requires `npm run verify` to stay green — so:
 *
 *   - **the pack is not installed** (its directory is not present at all) —
 *     there is nothing of that pack's to scan, and the scan legitimately
 *     runs over whatever *is* there. This is not a failure.
 *   - **the pack is installed, but a root the scan derived from it does not
 *     resolve** — the pack's own layout drifted out from under the scan.
 *     This is a real bug and must fail loudly, naming the root, rather than
 *     silently checking nothing (`sourceFiles()` returning `[]` for a
 *     missing root was exactly this mistake, `terrain-field-seam.test.ts`
 *     fix round 1).
 *
 * `installedPackDirs`/`packIsInstalled` answer the first question by
 * reading `packs/`'s own directory listing — every subdirectory is
 * "installed" for this purpose, no pack name hardcoded, so a pack leaving
 * (or a third pack arriving) changes this list without anyone touching a
 * scan that calls it. `requireRoot` answers the second: given a root the
 * caller already decided it needs, throw with a message naming it rather
 * than returning `[]` or `undefined`.
 *
 * This is the cheapest real derivation available before task 8 lands its
 * generated installed-packs barrel (the actual single source of truth for
 * "which packs does this checkout have"); once that barrel exists, point
 * `installedPackDirs` at it instead of `readdirSync`.
 */
export function installedPackDirs(packsDir: string): string[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir).filter(entry => statSync(join(packsDir, entry)).isDirectory());
}

/** Is `packName` (e.g. `'riot'`) present under `packsDir` right now? */
export function packIsInstalled(packsDir: string, packName: string): boolean {
  return installedPackDirs(packsDir).includes(packName);
}

/**
 * A root the caller derived from a pack it already knows is installed. If it
 * does not exist, that is the pack's own layout drifting out from under the
 * scan — a bug worth naming, not a directory to quietly skip.
 */
export function requireRoot(root: string, label: string): string {
  if (!existsSync(root)) {
    throw new Error(`${label}: declared root does not exist: ${root}`);
  }
  return root;
}
