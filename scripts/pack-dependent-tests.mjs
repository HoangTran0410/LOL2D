/**
 * Which test files cannot run without a content pack that is not installed.
 *
 * `vitest.config.ts` adds the answer to its own `exclude`, so a checkout with
 * no `packs/riot/` runs core's own suite rather than failing to start. This is
 * content-pack-extraction batch 5 task 8's answer to "what happens to the 107
 * test files that import the pack": nothing, yet — they stay exactly where
 * they are and keep running in every ordinary checkout, and they are skipped
 * only in the one condition where their subject is genuinely absent. Moving
 * them into the pack's own suite is the pack repository's job, on the day the
 * pack becomes a repository; deleting or rewriting 107 files to prove core can
 * boot without them would be paying that cost twice.
 *
 * ## Why a closure and not a glob
 *
 * `tests/packs/riot/**` is 68 of them and would have been a one-line glob. The
 * other ~39 are spread across `tests/game/spells/`, `tests/game/combat/`,
 * `tests/scenes/`, `tests/seams/` and `tests/content/` — they import a real
 * pack spell to check an engine rule against a real subject — and a glob would
 * have missed every one. Worse, some reach the pack *transitively*:
 * `tests/game/spell/registry.ts` value-imports the whole `packs/riot/spells`
 * barrel and eight test files import that helper without naming a pack
 * themselves. So this is a fixed point over `tests/`'s own import graph, not a
 * pattern: a file is pack-dependent if it names an absent pack, or if it
 * imports a `tests/` file that is.
 *
 * ## Why `scripts/` is walked too
 *
 * A test can reach a pack without any `packs/` string of its own, through a
 * *build script* it exercises: `tests/wiki/import-abilities.test.ts` drives
 * `scripts/wiki/import-abilities.mjs`, whose asset-download path loads
 * `packs/riot/scripts/generate-assets.mjs` to regenerate the pack's own
 * manifest. Nine of its seventeen tests failed on the drill's first clean run
 * with `Failed to load url ../../packs/riot/scripts/generate-assets.mjs`. So
 * the closure spans `tests/` and `scripts/` both, and returns only the
 * `tests/` half.
 *
 * `src/` is deliberately *not* walked, and does not need to be: core reaches a
 * pack in exactly two places, and neither can be absent. `src/content/install.ts`
 * names `packs/reference/`, which never leaves; `src/generated/installedPacks.ts`
 * names the optional packs, and it is *generated from what is installed*, so in
 * the very condition this function exists for it names nothing at all. Anything
 * else in `src/` reaching a missing pack fails the build, which is louder than
 * a skipped test and is the right outcome.
 *
 * ## What it deliberately does not catch
 *
 * A test that depends on the pack's *content* without importing it —
 * `expect(champions().length).toBeGreaterThan(30)`, `expect(availableMaps())
 * .toContain('riot:summoners-rift')` — is invisible here, and should be: the
 * fix for those is to derive the expectation from what is installed (see
 * `tests/support/installedPacks.ts`), not to stop running the test. Same for a
 * test that is *mostly* core and reads one pack file:
 * `moduleEvalGeometry.test.ts` and `ChampionSpellLifecycle.test.ts` each drop
 * one entry from a file list rather than sitting out. Every one of those was
 * found by running the drill and reading the failure; `PACK_CONTENT_FIXTURE_TESTS`
 * below is for the residue, where deriving is not possible.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The two kinds, over source whose string literals have already been lifted out
 * and replaced by their index in `literals`. See `readSource`.
 *
 * **`static`** — `import x from 'y'`, `export … from 'y'`, and `vi.mock('y')`
 * (which resolves the real module unless a factory is given, so it is loaded
 * for this purpose too). A static import of a module that is not there makes
 * the *file* unloadable, whatever else the file says, so nothing can excuse
 * one.
 *
 * **`deferred`** — `import('y')`. Vite leaves the specifier alone and nothing
 * resolves it until the expression is evaluated, so a `import()` behind a
 * condition that is false is inert. That is what lets a file keep the cases
 * that do not need the pack — see `HANDLES_ABSENCE`.
 */
const SPECIFIER = {
  static: /(?:\bfrom\s*|\bvi\.mock\s*\(\s*) (\d+) /g,
  deferred: /\bimport\s*\(\s*(\d+) /g,
};

/**
 * Every module specifier `source` actually imports.
 *
 * One left-to-right pass that always knows which of six things the cursor is
 * inside — code, a line comment, a block comment, a `'` string, a `"` string,
 * or a template literal — for the reason `src/seams/importScan.ts`'s own
 * `stripComments` gives at length: "comment start" is a property of *where*
 * two characters sit, not of the two characters, so two regexes run back to
 * back are wrong in both orderings.
 *
 * It has to go further than that module in one way, because what this scans is
 * `tests/`, and a source-scanning test's own fixture is an import statement
 * written out as data. Both shapes are in this repository:
 *
 *     const sample = `import { Ahri_Q } from '../../../packs/riot/spells';`;
 *     expect(scanImports("import { X } from '../../packs/riot/generated/x';"))
 *
 * A regex sees a real import in each, and on the first run both files —
 * `pregameBootPath.test.ts` and `importScan.test.ts`, two of the very scans
 * this task strengthened — were marked pack-dependent and would have been
 * silently skipped by the drill. So every string literal is lifted out into
 * `literals` and replaced by an opaque placeholder before `SPECIFIER` runs: a
 * `from` keyword *inside* a string can no longer sit next to a placeholder,
 * because the whole string became one placeholder. Template literals are
 * dropped outright — a real specifier is never inside one.
 *
 * Exported for `tests/scripts/packDependentTests.test.ts`, which pins the
 * static/deferred split directly: that distinction is what decides whether a
 * `packIsInstalled` gate is allowed to excuse a specifier, and no file in this
 * repository happens to carry both halves of the crossing for a fixture to
 * observe it through.
 *
 * `'`/`"` strings end at a raw newline as well as at their closing quote,
 * which is the same bound `importScan.ts` takes against an apostrophe in
 * ordinary prose: real JavaScript cannot hold an unescaped newline inside one,
 * so reaching one proves the opening quote was never a delimiter.
 */
export function readSource(source) {
  const literals = [];
  let state = 'code';
  let out = '';
  let current = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        i++;
      } else if (char === '/' && next === '*') {
        state = 'block';
        i++;
      } else if (char === "'" || char === '"') {
        state = char === "'" ? 'single' : 'double';
        current = '';
      } else if (char === '`') {
        state = 'template';
        out += ' ';
      } else {
        out += char;
      }
    } else if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
    } else if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        i++;
      }
    } else if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (char === '\\') {
        current += next ?? '';
        i++;
      } else if (char === quote || char === '\n') {
        literals.push(current);
        out += ` ${literals.length - 1} `;
        if (char === '\n') out += '\n';
        state = 'code';
      } else {
        current += char;
      }
    } else if (char === '\\') {
      i++;
    } else if (char === '`') {
      state = 'code';
    }
  }
  const at = regex => [...out.matchAll(regex)].map(match => literals[Number(match[1])]);
  return { static: at(SPECIFIER.static), deferred: at(SPECIFIER.deferred) };
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Test files that need a pack but say so nowhere an import scan can read,
 * keyed by the pack they need. Each entry is checked to exist (below), so the
 * list cannot rot into a set of paths that mean nothing.
 *
 * Two shapes, both found by running the drill and reading the failure:
 *
 *   - **the pack's *content*, reached ambiently.** The six lane tests read
 *     Summoner's Rift's waypoints out of `LANES`, which `tests/setup.ts`
 *     installs from the first installed pack's first map, and then assert
 *     against that map's own coordinates: `{ x: 400, y: 6075 }`, "spreads
 *     three bots over three lanes". With no pack installed there are no lanes
 *     — core ships no map's coordinates (Spec §7) and the reference pack's map
 *     has none — so each fails on an empty table. They are real tests of core
 *     lane maths and, in every literal number they assert, tests of one pack's
 *     map. The alternative considered and rejected: a synthetic lane set
 *     installed when no pack provides one. It would keep files like
 *     `MinionSpawner.test.ts` (which needs *some* lanes and no particular
 *     ones) running, and it cannot help these — there is no synthetic map
 *     Summoner's Rift's hand-written coordinates are true of.
 *   - **the pack's *files*, read from disk rather than imported.** Three:
 *     `cc-buff-icons.test.ts` `readFileSync`s forty pack spells by
 *     template-literal path, `vi-spell-names.test.ts` `readdirSync`s the whole
 *     spell directory, and `generateSpellCatalog.siblingRepo.test.ts` copies
 *     `packs/riot/spells` into a temporary directory to prove the generator
 *     works outside this repo. A scan cannot tell those apart from
 *     the same path quoted as a *fixture*, which `pregameBootPath.test.ts` and
 *     `importScan.test.ts` both do — a signal that matched the text excluded
 *     those two as well, i.e. it would have stopped the drill from running two
 *     of the very scans this task strengthened.
 *
 * A test that only *partly* depends on the pack belongs here not at all: gate
 * the pack half with `packIsInstalled` (`tests/support/installedPacks.ts`) and
 * keep the rest running, the way `moduleEvalGeometry.test.ts` and
 * `ChampionSpellLifecycle.test.ts` do.
 */
const PACK_CONTENT_FIXTURE_TESTS = {
  riot: [
    'tests/game/ai/LaneObjectives.test.ts',
    'tests/game/ai/TeamBlackboard.lanes.test.ts',
    'tests/game/ai/BotBrain.push.test.ts',
    'tests/game/ai/bot-clock.test.ts',
    'tests/game/minions/Minion.test.ts',
    'tests/game/minions/MinionLaneJoin.test.ts',
    'tests/game/spells/cc-buff-icons.test.ts',
    'tests/game/spells/vi-spell-names.test.ts',
    'tests/scripts/generateSpellCatalog.siblingRepo.test.ts',
  ],
};

/** The pack a specifier names, by either spelling, or `null`. */
const packNamed = specifier =>
  /(?:^|\/)packs\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(specifier)?.[1] ??
  /^@moba2d\/content-([A-Za-z0-9_-]+)(?:\/|$)/.exec(specifier)?.[1] ??
  null;

/**
 * Whether `source` declares that it has already handled `pack` being absent, by
 * naming it to `tests/support/installedPacks.ts`'s `packIsInstalled` — task 7's
 * seam, and the same one four scans in `tests/content/` already use.
 *
 * **This excuses a deferred import and never a static one.** A static import of
 * a missing module makes the file unloadable no matter what else it says, so
 * there is nothing for a runtime check to save; a deferred one behind
 * `packIsInstalled('riot') ? await import(…) : null` is never evaluated and
 * never resolved.
 *
 * The pack has to be named, not merely the function called, so a file that
 * handles one pack's absence does not accidentally excuse itself for another's.
 * Four files carry this today (`PregameConfig`, `Stats`, `TeamBlackboard`,
 * `Vision`) and between them it is 105 tests of stat ceilings, regen, vision,
 * line of sight and blackboard bucketing — core mechanism, every one of them —
 * that round 1 skipped over a single `it()` apiece.
 */
const handles = (source, pack) =>
  new RegExp(`packIsInstalled\\(\\s*['"\`]${pack}['"\`]`).test(source);

/**
 * Every test file under `tests/` that reaches a pack outside `installed`, as
 * paths relative to `root` — the form Vitest's `exclude` matches.
 *
 * `installed` is the set of local pack names this checkout has (`['reference',
 * 'riot']`), from `scripts/installed-packs.mjs`. A pack directory that is
 * present is never excluded, so an ordinary checkout gets an empty list back
 * and the whole suite runs — which the caller can and does assert.
 *
 * Three signals, in the order they were found by running the drill:
 *
 *   1. **an import** of an absent pack, directly or transitively — the
 *      overwhelming majority, and the only one a build could have told you
 *      about;
 *   2. **living under `tests/packs/<pack>/`** — that directory is named after
 *      the pack whose tests it holds, so it needs no list of its own. Sixty-
 *      eight files, five of which reach their subject only by `readFileSync`
 *      and would be invisible to signal 1;
 *   3. **the named list above**, for what neither of those can see.
 */
export function packDependentTests(root, installed) {
  const testsDir = join(root, 'tests');
  const files = [...filesUnder(testsDir), ...filesUnder(join(root, 'scripts'))];
  const sources = new Map(files.map(file => [file, readFileSync(file, 'utf8')]));

  /** file -> the `tests/` files it imports, resolved to absolute paths. */
  const localImports = new Map();
  const dependent = new Set();

  for (const [pack, paths] of Object.entries(PACK_CONTENT_FIXTURE_TESTS)) {
    for (const path of paths) {
      const full = join(root, path);
      if (!sources.has(full)) {
        throw new Error(
          `PACK_CONTENT_FIXTURE_TESTS lists ${path} for the ${pack} pack, and no such test file ` +
            'exists — rename it in both places, or drop the entry if the test is gone'
        );
      }
      if (!installed.includes(pack)) dependent.add(full);
    }
  }

  for (const [file, source] of sources) {
    const specifiers = readSource(source);
    const locals = [];
    const own = /(?:^|\/)tests\/packs\/([A-Za-z0-9_-]+)\//.exec(
      file.slice(root.length).replace(/\\/g, '/')
    )?.[1];
    if (own && !installed.includes(own)) dependent.add(file);
    for (const kind of ['static', 'deferred']) {
      for (const specifier of specifiers[kind]) {
        const pack = packNamed(specifier);
        if (pack && !installed.includes(pack) && !(kind === 'deferred' && handles(source, pack))) {
          dependent.add(file);
        }
        if (specifier.startsWith('.')) locals.push(resolve(dirname(file), specifier));
      }
    }
    localImports.set(file, locals);
  }

  // Fixed point: importing a pack-dependent helper makes you pack-dependent.
  // Extensionless relative specifiers are matched by prefix, which is why the
  // candidate set is `files` rather than a filesystem probe.
  for (let changed = true; changed;) {
    changed = false;
    for (const [file, locals] of localImports) {
      if (dependent.has(file)) continue;
      const reaches = locals.some(target =>
        [...dependent].some(other => other === target || other.startsWith(`${target}.`))
      );
      if (reaches) {
        dependent.add(file);
        changed = true;
      }
    }
  }

  return [...dependent]
    .filter(file => file.startsWith(`${testsDir}/`))
    .map(file => relative(root, file).replace(/\\/g, '/'))
    .sort();
}
