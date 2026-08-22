/**
 * Which content packages this checkout actually has installed — the one
 * derivation, read by everything that needs the answer.
 *
 * ## Why `node_modules/@moba2d/`, and not `packs/`
 *
 * `packs/` is where this monorepo happens to keep its two packs today. It is
 * not what "installed" means. A pack is a package — `@moba2d/content-riot`
 * declares itself one, `package.json`'s `workspaces` links it, and the day it
 * becomes a repository of its own the only thing that changes is that
 * `node_modules/@moba2d/content-riot` stops being a symlink into this tree
 * and starts being a real directory `npm install` fetched. Reading the
 * directory listing of `packs/` answers the question for exactly as long as
 * both packs live here; reading `node_modules/@moba2d/` answers it either
 * way, which is the whole point of the extraction.
 *
 * It is also the only reading that survives the departure drill honestly:
 * `npm run verify:without-packs` moves `packs/riot/` out of the tree *and*
 * re-runs `npm install`, and it is the second step that makes the pack
 * genuinely gone. A dangling symlink left behind by skipping it would still
 * let `packs/`-listing say "absent" while a bare-specifier import said
 * "present".
 *
 * ## Three readers, one answer
 *
 *   - `scripts/generate-installed-packs.mjs` materializes this into
 *     `src/generated/installedPacks.ts`, the barrel `src/content/install.ts`
 *     and `tests/setup.ts` read. TypeScript cannot call this module at
 *     compile time, so the answer has to become a file — the same idiom
 *     `src/generated/assetManifest.ts` and `spellCatalog.ts` already are.
 *   - `scripts/check-chunks.mjs` reads it directly, for the per-champion
 *     spell-chunk check: that check is only meaningful in a build that has
 *     the pack providing those champions, and since the whole-branch fix
 *     pass it also takes the pack's *directory* from here
 *     (`installedContentPackages(...).dir`) to derive the chunk names it
 *     expects, rather than pinning a literal floor.
 *   - `vitest.config.ts` reads it to know which packs are installed, then
 *     hands that list to `scripts/pack-dependent-tests.mjs` — which takes
 *     the answer as an argument rather than importing this module, so it is
 *     a consumer and not a fourth reading.
 *
 * (`tests/support/installedPacks.ts` is a fifth *reader* but not a fifth
 * answer: it reads the generated barrel this module produces, which is this
 * answer materialized for a compiler that cannot call a script.
 * `tests/content/installedPacksBarrel.test.ts` asserts the two agree.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The npm scope every content pack lives under, and the prefix that marks one. */
const SCOPE = '@moba2d';
const PACKAGE_PREFIX = 'content-';

/**
 * Packs that are core's own and are never optional.
 *
 * The reference pack is core's content — four spells, one champion, one map —
 * and it is what makes core a complete game standing alone rather than a
 * menu. `src/content/install.ts` imports it plainly and unconditionally, so
 * it must not appear among the barrel's *optional* entries or it would be
 * installed twice. It still appears in `installedPackNames`, because "which
 * packs does this checkout have" is a different question from "which packs
 * does the barrel have to import for `install.ts`".
 */
const CORE_OWN = new Set([`${SCOPE}/content-reference`]);

/**
 * A pack's local name — `@moba2d/content-riot` -> `riot`. This is the name
 * its directory carries under `packs/`, the id its manifest declares, and the
 * prefix its qualified spell and map ids use. Stated once, here, rather than
 * re-derived by each caller.
 */
export const localName = packageName => packageName.slice(`${SCOPE}/${PACKAGE_PREFIX}`.length);

/**
 * Every `@moba2d/content-*` package resolvable from `root`, sorted by package
 * name so the generated barrel is stable across machines (`readdirSync` order
 * is not guaranteed).
 *
 * A symlink whose target is gone is *not* installed: `existsSync` follows the
 * link, which is exactly the reading the departure drill needs.
 */
export function installedContentPackages(root) {
  const scopeDir = join(root, 'node_modules', SCOPE);
  if (!existsSync(scopeDir)) return [];
  const found = [];
  for (const entry of readdirSync(scopeDir)) {
    if (!entry.startsWith(PACKAGE_PREFIX)) continue;
    const dir = join(scopeDir, entry);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const packageName = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
    if (packageName !== `${SCOPE}/${entry}`) {
      throw new Error(
        `node_modules/${SCOPE}/${entry} declares itself "${packageName}" — a content pack's ` +
          'directory name and package name must agree, or a bare-specifier import resolves ' +
          'to a pack nobody named'
      );
    }
    found.push({
      packageName,
      name: localName(packageName),
      dir,
      coreOwn: CORE_OWN.has(packageName),
    });
  }
  return found.sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/** The optional half — every installed pack `install.ts` has to be told about. */
export const optionalContentPackages = root =>
  installedContentPackages(root).filter(pack => !pack.coreOwn);

/** Is one pack, by local name (`'riot'`), installed right now? */
export const contentPackInstalled = (root, name) =>
  installedContentPackages(root).some(pack => pack.name === name);
