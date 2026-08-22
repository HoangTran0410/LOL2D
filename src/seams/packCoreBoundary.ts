import { dirname, resolve, sep } from 'node:path';
import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';
import { scanImports } from './importScan';

/**
 * A pack reaches core through the injected `ContentApi` and core's declared
 * public subpaths, and nowhere else.
 *
 * This is the rule the whole extraction rests on, and until fix round 4 of
 * content-pack-extraction batch 5 task 6 it was the one rule enforced on the
 * **wrong side**. `tsconfig.base.json` publishes core's own `@/*` alias so a
 * pack's `tsc` can see types *through* `ContentApi.ts`'s own internal
 * imports — a real need — and the side effect is that a pack file can name
 * any file under core's `src/`. Measured, not reasoned about: with
 * `import type SlowInternal from '@/game/gameObject/buffs/Slow'` planted at
 * the top of a pack spell, the pack's own `typecheck` exited 0, the pack's
 * own `check-seams` printed `scanned 237 file(s), clean`, and the only thing
 * that went red was `tests/content/packBoundary.test.ts` — a test in *core's*
 * tree, run by *core's* `verify`. The task those gates exist for says a pack
 * that breaks an engine rule reddens the pack's build, not the engine's, and
 * this was the inversion of it for the rule where it matters most. Worse, it
 * was an inversion with a shelf life: once `packs/riot/` is a sibling
 * repository, that core-side test has no population left to scan.
 *
 * ## Scoped to a package, not to a scanned tree
 *
 * Every other seam in this module answers a question about the file in front
 * of it, so it runs over whatever root the caller points at — `./spells`,
 * `./monsters`. This one answers a question about a *package*: a pack's
 * entry point (`pack.ts`), its generated barrels, its map and vfx modules
 * are all just as able to reach into core as a spell is, and are not under
 * any of those trees. So `scripts/check-seams.mjs` calls this seam with the
 * **owning package's root** rather than the scanned tree, which is also why
 * it is exported separately instead of sitting in `seams` beside the other
 * thirteen: `checkSeams(root)` runs rules that all mean the same thing about
 * the same `root`, and this one would silently mean something narrower there.
 *
 * ## It does not apply to core's own trees
 *
 * `@/...` *is* how core's own source refers to itself; core's `check-seams`
 * script scans core's own `coreSpells/`, `spellObjects/`, `buffs/` and
 * `attackableUnits/`, and every one of those files reaches its neighbours
 * that way. The CLI decides by ownership — it resolves the `package.json`
 * that owns the scanned tree and skips this seam when that package is core
 * itself — rather than by a flag a pack could set, and rather than by a
 * hard-coded path that stops meaning anything once a pack is a repository of
 * its own. See `scripts/check-seams.mjs`'s `owningPackage`.
 *
 * ## No exemption set, on purpose
 *
 * Every other rule here ships with a licence to break it, because every
 * other rule met code that predated it. This one has never had an exception
 * in either pack, and an exception is not a debt that gets paid down later —
 * a pack file naming a core internal is a file that cannot leave the
 * repository. `skip` still applies (it is read by `walkTsFiles`, shared by
 * every seam), which is the one lever a pack has, and a `skip` entry is
 * itself checked for staleness.
 */

/** The package name core publishes itself under — its own name for itself. */
const CORE_PACKAGE = '@moba2d/core';

/**
 * The only three specifiers a pack file may name, and only as `import type`.
 * `ContentApi` also exports a real function, `buildContentApi()`, that only
 * core's own `install.ts` may call — so a pack writing
 * `import { buildContentApi } from '@moba2d/core/content/ContentApi'` (no
 * `type` keyword) is reaching for a value, not a type, and is refused like
 * any other core import. The API itself arrives as the argument to the
 * pack's factory; it is never imported.
 */
const ALLOWED_TYPE_ONLY = new Set([
  `${CORE_PACKAGE}/content/ContentApi`,
  `${CORE_PACKAGE}/content/ContentPack`,
  `${CORE_PACKAGE}/content/types`,
]);

/** Whether a relative specifier resolves outside the package being scanned. */
function escapesPackage(packageRoot: string, file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolved = resolve(dirname(resolve(packageRoot, file)), specifier);
  return resolved !== packageRoot && !resolved.startsWith(packageRoot + sep);
}

/**
 * `root` is the pack's own package root — the directory its `package.json`
 * sits in — not one of the trees the other seams scan.
 */
export const checkPackCoreBoundary: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    // Comments are stripped by `scanImports` itself, or this rule's own
    // prose about `@/...` would flag the files that document it.
    for (const { specifier, kind } of scanImports(readSource(root, file))) {
      const isOldAlias = specifier === '@' || specifier.startsWith('@/');
      const isBareSrc = specifier === 'src' || specifier.startsWith('src/');
      const isCorePackage = specifier === CORE_PACKAGE || specifier.startsWith(`${CORE_PACKAGE}/`);
      const isRelativeEscape = escapesPackage(root, file, specifier);

      if (isOldAlias || isBareSrc) {
        violations.push({
          file,
          message: `${specifier} — a core internal named through an alias no separated pack can resolve`,
        });
      } else if (isRelativeEscape) {
        violations.push({
          file,
          message: `${specifier} — a relative path out of this package; a package is reached by its name`,
        });
      } else if (isCorePackage && !ALLOWED_TYPE_ONLY.has(specifier)) {
        violations.push({
          file,
          message: `${specifier} — not one of core's public content subpaths`,
        });
      } else if (isCorePackage && kind !== 'type') {
        violations.push({
          file,
          message: `${specifier} — imported as a value, not a type`,
        });
      }
    }
  }

  return violations;
};
