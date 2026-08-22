import { existsSync } from 'node:fs';
import { installedPackNames } from '../../src/generated/installedPacks';

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
 * `installedPackDirs`/`packIsInstalled` answer the first question, and since
 * task 8 they answer it out of `src/generated/installedPacks.ts` — the
 * generated barrel `src/content/install.ts` and `tests/setup.ts` already read
 * — rather than by listing `packs/` themselves. Task 7's own header said to
 * do exactly this once the barrel existed, and the reason is the one that
 * motivated the barrel: a directory listing of `packs/` answers "which packs
 * are installed" for precisely as long as every pack lives in this
 * repository, which is the assumption the whole extraction exists to remove.
 * `installedPackNames` covers the reference pack too, so a scan's population
 * does not collapse when the optional pack leaves. `requireRoot` answers the
 * second question: given a root the caller already decided it needs, throw
 * with a message naming it rather than returning `[]` or `undefined`.
 */
export function installedPackDirs(): string[] {
  return [...installedPackNames];
}

/** Is `packName` (e.g. `'riot'`) installed right now? */
export function packIsInstalled(packName: string): boolean {
  return installedPackDirs().includes(packName);
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
