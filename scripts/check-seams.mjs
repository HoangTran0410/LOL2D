#!/usr/bin/env node
/**
 * The CLI form of `@moba2d/core/seams` (`src/seams/index.ts`), and the
 * working implementation of spec §8.1's pack-side command
 * `moba2d-check-seams ./src` — a pack's own build step, checking a pack's
 * own tree, failing a pack's own build.
 *
 * `package.json`'s `bin` field points here and the workspace link that
 * makes `moba2d-check-seams` resolve as a bare command already exists — but
 * two real bugs, both found in content-pack-extraction batch 5 task 5's fix
 * round 1, meant that bare command did nothing:
 *
 * 1. **The self-invoke guard.** `process.argv[1] === scriptPath` compared
 *    the raw argv path against `import.meta.url`'s resolved real path.
 *    Invoked through the `node_modules/.bin/moba2d-check-seams` symlink,
 *    Node resolves `import.meta.url` to the symlink's real target but
 *    leaves `process.argv[1]` as the symlink path itself — the two never
 *    compared equal, so this whole block silently never ran: no output, no
 *    error, exit 0, on a target with real violations. `realpathSync` below
 *    is the fix; `scripts/generate-spell-catalog.mjs` has the identical
 *    pattern and the same fix, found first there.
 *
 * 2. **The target root.** `resolve(repoRoot, targetRoot)` resolved a
 *    CLI-supplied relative path against *this script's own* directory —
 *    core's root — rather than against wherever the invoking shell actually
 *    stood. Inside this monorepo, `cd packs/riot && node ../../scripts/
 *    check-seams.mjs ./spells` and `node scripts/check-seams.mjs
 *    packs/riot/spells` happen to name the same directory relative to
 *    `repoRoot`, so this passed every test that invoked it from the repo
 *    root — but the first form is exactly how a pack (or a sibling
 *    repository) actually calls it, and it threw ENOENT. A bare `resolve()`
 *    resolves against `process.cwd()`, which is the only meaning "the
 *    current directory" can have when this script is a devDependency
 *    installed somewhere else entirely.
 *
 * `src/seams/index.ts` is plain TypeScript with no p5/browser dependency —
 * just `node:fs` — but it lives under `src/`, which is not run directly by
 * Node. This loads it the same way `scripts/generate-spell-catalog.mjs`
 * loads spell barrels: Vite's SSR module graph, so `@/` aliases resolve and
 * the loaded module is real compiled TypeScript, not a hand-rolled reimplementation.
 *
 *   node scripts/check-seams.mjs ./packs/riot/spells
 *
 * Exits 1 and prints one line per violation if any seam finds one; exits 0
 * and prints a summary otherwise.
 *
 * ## Thirteen rules over the named tree, and two over the package
 *
 * `checkSeams(root)` runs the thirteen rules that all mean the same thing
 * about the same directory. Two more are scoped to a *package* instead,
 * because a pack's `pack.ts`, its generated barrels, its maps, its monster
 * factories and its vfx modules can break them exactly as a spell can and
 * none of them sit under `./spells`:
 *
 *   - `pack-core-boundary` — "a pack reaches core only through its public
 *     content subpaths" (fix round 4 of content-pack-extraction batch 5 task
 *     6; before it, that rule lived only in `tests/content/
 *     packBoundary.test.ts`, so a pack breaking the rule the entire
 *     extraction rests on reddened *core's* build and nothing of the pack's).
 *   - `pack-asset-key` — "a pack resolves art through its own manifest, never
 *     a bare key from core's" (batch 5 whole-branch review; before it, that
 *     rule was `tests/content/packAssetKeyBoundary.test.ts`, a core-side scan
 *     of all of `packs/`, with the same inversion).
 *
 * So this script resolves the `package.json` that owns the scanned tree
 * (`owningPackage`) and runs both over the whole package — unless the owner
 * is core itself, since `@/...` is how core's own source refers to itself and
 * core's own keys are core's to use.
 *
 * ## A pack's own debt is the pack's to state, not the engine's
 *
 * `checkSeams(root, options)` takes one `options` object, shared across all
 * thirteen seams (`src/seams/index.ts`) — a `skip` set every seam honours,
 * plus whatever narrower field an individual seam's own `*Options` type
 * adds (`grandfathered`, `grandfatheredClasses`, `noPressOverride`,
 * `pinned`, `maxMs`, ...). A grandfathered cast spec or a pinned
 * `worldMouse` line is a fact about *that pack's content*, never about the
 * rule itself (spec §8.1, content-pack-extraction batch 5 task 6) — so it
 * cannot live in `src/seams/`, and the pack's own `package.json` scripts
 * are fixed at `moba2d-check-seams ./spells` (and, where a pack authors
 * more than one tree, `./monsters` and the like) with no room for extra
 * flags — the form that keeps working once a pack is a sibling repository
 * rather than a workspace here. `loadPackSeamDebt` below is the
 * resolution: a plain ESM file, `seam-debt.mjs`, living *inside* whatever
 * root the CLI was pointed at — `packs/riot/spells` looks for
 * `packs/riot/spells/seam-debt.mjs`, `packs/riot/monsters` for
 * `packs/riot/monsters/seam-debt.mjs`, each independently. Colocated with
 * the tree it describes, not one directory above it (fix round 3 of task
 * 6: a pack that authors more than one scanned tree, as `packs/riot` does
 * once `check-seams:monsters` exists, would otherwise have both trees
 * discover the *same* sibling file — every entry meant for `./spells`
 * would apply, wrongly, to a `./monsters` run too, which the new
 * stale-exemption check (`src/seams/index.ts`) turned from a harmless
 * no-op into seventeen false "stale" reports the moment it existed to
 * notice). `.mjs`, not `.ts`, so `walkTsFiles` never picks the debt file
 * itself up as a spell to check. No TypeScript, no `vite`, no
 * `@moba2d/core` import needed to read it, so it is exactly as portable as
 * the debt it describes: it moves with the pack's own directory, monorepo
 * workspace today or a standalone checkout tomorrow. A tree with no debt
 * (`packs/reference/spells`, `packs/riot/monsters`, today) simply has no
 * such file, and `checkSeams` runs every seam at its strictest default.
 */
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'vite';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');

/**
 * `<targetRoot>/seam-debt.mjs` — *inside* the scanned tree, not a sibling
 * of it (fix round 3; see this file's own header for why the distinction
 * matters) — loaded as plain ESM (not through Vite's SSR graph — this file
 * has no TypeScript and no reason to depend on `@moba2d/core` just to be
 * read) and returning its named `seamDebt` export, or `undefined` when
 * this specific tree has declared no debt at all.
 */
async function loadPackSeamDebt(absoluteTarget) {
  const debtConfigPath = resolve(absoluteTarget, 'seam-debt.mjs');
  if (!existsSync(debtConfigPath)) return undefined;
  const module = await import(pathToFileURL(debtConfigPath).href);
  return module.seamDebt;
}

/**
 * The package that owns `fromDir` — the nearest `package.json` at or above
 * it, and its declared name. `packs/riot/spells` answers
 * `packs/riot` / `@moba2d/content-riot`; `src/game/gameObject/coreSpells`
 * answers this repository's root / `@moba2d/core`.
 *
 * This is how `pack-core-boundary` (the fourteenth seam,
 * `src/seams/packCoreBoundary.ts`) decides whether it applies at all:
 * `@/...` is how core's own source refers to itself, so the rule "reach core
 * only through its public subpaths" is a rule about *someone else's* tree.
 * Deliberately not a CLI flag and not a field in the pack's own
 * `seam-debt.mjs` — a rule a pack can switch off for itself is not a gate —
 * and deliberately not a hard-coded path, which stops meaning anything the
 * day a pack is a repository of its own. Fail-closed: no `package.json`
 * anywhere above the target means "not core", so the rule runs.
 */
function owningPackage(fromDir) {
  let dir = fromDir;
  for (;;) {
    const manifest = resolve(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        return { root: dir, name: JSON.parse(readFileSync(manifest, 'utf8')).name };
      } catch {
        return { root: dir, name: undefined };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { root: fromDir, name: undefined };
    dir = parent;
  }
}

/** Core's own name for itself, read from core's own manifest rather than typed twice. */
function corePackageName() {
  try {
    return JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).name;
  } catch {
    return undefined;
  }
}

export async function runCheckSeams(targetRoot) {
  const server = await createServer({
    root: repoRoot,
    // `configFile: false`, not core's own `vite.config.ts` (fix round 4).
    // Loading that config drags in core's *devDependencies* — it imports
    // `@vitejs/plugin-vue` and `vite-plugin-pwa` — which a pack installing
    // `@moba2d/core` as a dependency never receives. Measured from a real
    // sibling checkout outside this repository, with core installed from an
    // `npm pack` tarball: `moba2d-check-seams ./spells` died with
    // `Cannot find package '@vitejs/plugin-vue'` before it read a line of
    // the pack's code. Nothing under `src/seams/` needs any of it — the
    // whole directory imports `node:fs`, `node:path` and its own siblings
    // and nothing else, so the only thing Vite is doing here is compiling
    // TypeScript. The pack's own gate has to run from the pack's own
    // repository, or it is not the pack's gate.
    configFile: false,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const { checkSeams, scannedSeamFiles } = await server.ssrLoadModule('/src/seams/index.ts');
    // Resolved against the invoking shell's own directory, not this
    // script's — `resolve()` with a single argument is `process.cwd()`.
    // This is the fix for fix round 1's HIGH 1-shaped bug: the old
    // `resolve(repoRoot, targetRoot)` answered "where is `targetRoot`
    // relative to core's own checkout", which is not what a CLI argument
    // means once this script is installed somewhere other than where it is
    // invoked from.
    const absoluteTarget = resolve(targetRoot);
    const options = await loadPackSeamDebt(absoluteTarget);
    const violations = checkSeams(absoluteTarget, options).map(violation => ({
      ...violation,
      // Report relative to the target root, which is what a violation's
      // `file` already is — kept here only for the summary's own path math.
      root: relative(process.cwd(), absoluteTarget) || '.',
    }));
    // Every seam walks the same tree `checkSeams` just did; this is that
    // same walk, done once more, so the summary can say how much ground it
    // covered. Without it, an empty `violations` array reads as "clean" for
    // both a genuinely clean root and a root that does not exist (or whose
    // every file matched `skip`) — indistinguishable to whoever is reading
    // the CLI's own default output. Passed the same `options` as `checkSeams`
    // above so a `skip`-exempted file — debt or a barrel — is not counted as
    // "scanned" either; the two numbers describe the same walk.
    const scannedCount = scannedSeamFiles(absoluteTarget, options).length;

    // The fourteenth rule, scoped to the package rather than to this one
    // tree: a pack's entry point, generated barrels, maps and vfx modules
    // can reach into core exactly as a spell can, and none of them sit
    // under `./spells`. Skipped when the scanned tree belongs to core
    // itself. Given no `options`: the debt a pack declares is about its
    // spells (`skip: index.ts` is the barrel it does not want scanned as a
    // spell), and a barrel is the *most* likely place for a core re-export
    // to hide, so this rule sees every file either way.
    const owner = owningPackage(absoluteTarget);
    const boundary = owner.name === corePackageName() ? null : owner;
    if (boundary) {
      const { packCoreBoundarySeam, packAssetKeySeam } =
        await server.ssrLoadModule('/src/seams/index.ts');
      const boundaryRoot = relative(process.cwd(), boundary.root) || '.';
      for (const seam of [packCoreBoundarySeam, packAssetKeySeam]) {
        for (const violation of seam.check(boundary.root)) {
          violations.push({ ...violation, seamId: seam.id, root: boundaryRoot });
        }
      }
      return {
        violations,
        scannedCount,
        boundary: {
          package: boundary.name ?? boundaryRoot,
          seamIds: [packCoreBoundarySeam.id, packAssetKeySeam.id],
          scannedCount: scannedSeamFiles(boundary.root).length,
        },
      };
    }

    return { violations, scannedCount, boundary: null };
  } finally {
    await server.close();
  }
}

// `realpathSync`, not a bare `resolve()` — see this file's own header for
// why: reached through the `node_modules/.bin/` symlink, `process.argv[1]`
// stays the symlink path while `scriptPath` is already resolved to the
// real file, and a plain string comparison never matches.
function invokedDirectly() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(resolve(invoked)) === scriptPath;
  } catch {
    return resolve(invoked) === scriptPath;
  }
}

if (invokedDirectly()) {
  const targetRoot = process.argv[2];
  if (!targetRoot) {
    console.error('usage: node scripts/check-seams.mjs <root>');
    process.exit(2);
  }

  runCheckSeams(targetRoot)
    .then(({ violations, scannedCount, boundary }) => {
      if (violations.length === 0) {
        console.log(`check-seams: scanned ${scannedCount} file(s), clean (${targetRoot})`);
        if (boundary) {
          console.log(
            `check-seams: ${boundary.seamIds.join(' + ')} scanned ${boundary.scannedCount} file(s) of ${boundary.package}, clean`
          );
        }
        return;
      }
      // Fix round 3: a stale exemption ("you are exempting something that
      // no longer offends") and a real violation ("you broke a rule") are
      // opposite problems with opposite fixes, so they print under
      // different labels rather than one undifferentiated list — a run
      // that prints them the same way trains people to ignore both. Both
      // still fail the run; see `src/seams/index.ts`'s own header for why.
      const realViolations = violations.filter(v => v.kind !== 'stale-exemption');
      const staleExemptions = violations.filter(v => v.kind === 'stale-exemption');
      for (const v of realViolations) {
        console.error(`${v.seamId} :: ${v.root}/${v.file} :: ${v.message}`);
      }
      for (const v of staleExemptions) {
        console.error(`STALE-EXEMPTION :: ${v.seamId} :: ${v.root}/${v.file} :: ${v.message}`);
      }
      const parts = [];
      if (realViolations.length > 0) parts.push(`${realViolations.length} violation(s)`);
      if (staleExemptions.length > 0) parts.push(`${staleExemptions.length} stale exemption(s)`);
      console.error(
        `check-seams: ${parts.join(', ')} across ${scannedCount} file(s) scanned in ${targetRoot}`
      );
      if (boundary) {
        console.error(
          `check-seams: pack-core-boundary scanned ${boundary.scannedCount} file(s) of ${boundary.package}`
        );
      }
      process.exitCode = 1;
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
