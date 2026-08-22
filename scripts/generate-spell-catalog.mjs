#!/usr/bin/env node
/**
 * Generates `src/generated/spellCatalog.ts` — every spell's *display* data as
 * plain values, so the pregame screen can render the whole roster without
 * importing a single spell class.
 *
 * ## Invoked by a pack, not just core
 *
 * `package.json`'s `bin` also names this `moba2d-generate-spell-catalog` —
 * content-pack-extraction batch 5 task 5's answer to "how does a pack ask
 * core to build its catalogue?" Unlike `scripts/generate-assets.mjs --tree=
 * riot` (moved into the pack outright, since that walk has zero core
 * dependency), this generator constructs every spell and reads its fields,
 * which needs a real `ContentApi` — core's runtime, at build time, even
 * though a pack needs none of it at play time. So core keeps owning the
 * mechanism and a pack invokes it by name: `packs/riot/package.json`'s
 * `catalog:generate` runs `moba2d-generate-spell-catalog --tree=riot`, the
 * same shape `check-seams.mjs` established for itself in task 3. npm's
 * workspace bin symlink resolves that name today; a sibling repository with
 * `@moba2d/core` installed as a devDependency resolves it the same way, from
 * its own `node_modules/.bin/` — nothing about the specifier changes.
 *
 * That symlink is exactly why the self-invoke check below compares
 * `realpathSync` output rather than the raw argv path: `import.meta.url`
 * always names this file's real location, but `process.argv[1]` keeps
 * whatever path was actually invoked — the bin symlink itself when run that
 * way — and a bare `resolve()` never reconciles the two.
 *
 * ## The tree's root is a caller argument, not a table in this file
 *
 * Fix round 1 (content-pack-extraction batch 5, task 5): `PACK_SPELL_TREES.riot`
 * used to hardcode its paths (`'packs/riot/generated/spellCatalog.ts'`, etc.)
 * relative to *this script's own* directory — i.e. core's root. That
 * coincides with where the pack actually lives inside this monorepo, so
 * every existing call and test passed, for the wrong reason: the day the
 * pack is a sibling repository, `packs/riot/` no longer sits under this
 * file at all, and the same call resolves nonsense paths under core's own
 * checkout instead. `scripts/check-seams.mjs` has the identical shape —
 * `resolve(repoRoot, targetRoot)` instead of `resolve(targetRoot)` — and
 * the review that found this confirmed it the same way: `cd packs/riot &&
 * node ../../scripts/check-seams.mjs ./spells` throws ENOENT against the
 * wrong root.
 *
 * So every tree's paths (`outputPath`, `modulesOutputPath`, `barrels[].path`,
 * `assetManifestOutputPath`) are now relative to a `treeRoot` argument
 * `renderSpellCatalogSource`/`renderSpellModulesSource`/`generateSpellCatalog`
 * all take explicitly, defaulting to `coreRoot` (this file's own directory)
 * only because that is genuinely what `CORE_SPELL_TREE` means — core
 * generating its own catalogue against itself needs no argument from
 * anyone. A pack tree has no such default: the CLI below *requires*
 * `--root=<path>` whenever `--tree=` names one, resolved from the
 * *invoking shell's* current directory, never from this file's location.
 * `packs/riot/package.json`'s own `catalog:generate` passes `--root=.`
 * (its own directory); this repo's root `package.json` passes
 * `--root=packs/riot` for the same tree, because *its* current directory
 * is the monorepo root instead. Core no longer hardcodes the string
 * `"packs/riot"` as a location anywhere — only as a tree *name*
 * (`PACK_SPELL_TREES`'s key), which is metadata about the tree's shape
 * (its barrels, whether it is a pack factory, its asset-manifest
 * companion), not a claim about where it lives on disk.
 *
 * Because a pack's tree root can now be physically outside `coreRoot`
 * entirely, barrel and asset-manifest loads go through Vite's `/@fs/`
 * absolute-path form rather than a root-relative URL, and the dev server's
 * `fs.allow` explicitly lists both roots — otherwise Vite's default file
 * boundary refuses to serve anything outside its own project root.
 *
 * ## Why this exists
 *
 * `preset.ts` used to answer "what does this ability look like in the picker?"
 * by doing `new SpellClass({ game: { matchRules } })` and reading seven fields
 * off the instance. Correct, and cheap per call — but it needs the *class*, so
 * the setup screen imported `import * as AllSpells`, and that one line put all
 * 238 spell modules (~71% of the 1.1MB game chunk) behind a screen that only
 * ever wanted names, icons and numbers.
 *
 * Constructing them once here, at build time, is the same answer with the code
 * left behind.
 *
 * ## What is stored, and what is not
 *
 * Two of `SpellDisplay`'s seven fields depend on match rules, and both are pure
 * functions of the other five — `Spell.reducedCooldown` is `d * multiplier` and
 * `Spell.effectiveMana` is `manaFree ? 0 : amount`. So this stores the *rule-free*
 * numbers and `config/spellCatalog.ts` reapplies the rules at render time. Nothing
 * here knows what URF is.
 *
 * `iconKey`, not `iconUrl`: a URL is a content hash that changes every time the
 * image does, and baking one into a checked-in file would mean this generator
 * had to re-run for a reason that has nothing to do with spells.
 *
 * ## The catch that isn't
 *
 * `getSpellDisplay` wraps construction in a `try/catch` because it runs in a
 * browser where one broken spell must not take the picker down with it. Here
 * the opposite is right: a spell that cannot describe itself is a bug, and the
 * build is exactly where it should stop. So this reimplements the read rather
 * than calling `getSpellDisplay`, and throws.
 *
 *   npm run catalog:generate     # rewrite the file
 *   npm run catalog:check        # fail if it is stale (runs in `verify`)
 *
 * Descriptions interpolate tuning constants (`${Q_DAMAGE}`), which is why the
 * check is in `verify`: retuning a spell without regenerating would leave the
 * setup screen quoting numbers the engine no longer uses.
 */
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptPath = fileURLToPath(import.meta.url);
const coreRoot = resolve(dirname(scriptPath), '..');

/**
 * A tree this generator can build a catalogue for: a list of barrels (each
 * an `index.ts` of `export { default as X } from './X'` lines) plus where
 * the two output files land. Later barrels win an id clash against earlier
 * ones — "content-last" below is this rule applied to core's own two.
 *
 * `importBase` is the module specifier prefix a spell in that barrel is
 * imported through in the generated `spellModules.ts` — `@/game/gameObject/
 * spells` for core's content barrel, so the emitted line reads
 * `import('@/game/gameObject/spells/Yasuo_Q')`, exactly as it did before
 * this generalisation existed. It is per-barrel, not per-tree, because
 * that is what `coreIds` was really encoding: not "which barrel" but
 * "which directory does this id's file live in" — the barrel a spell
 * comes from already answers that, so carrying it on the merged entry
 * replaces the separate set entirely rather than sitting beside it.
 */
export const CORE_SPELL_TREE = {
  outputPath: 'src/generated/spellCatalog.ts',
  modulesOutputPath: 'src/generated/spellModules.ts',
  // Batch 4 Task 3 moved `src/game/gameObject/spells/` into `packs/riot/spells/`
  // (see `PACK_SPELL_TREES.riot` below) — `BasicAttack` is now the only spell
  // core generates a catalogue entry for at all, which is the whole point of
  // `coreSpells/`'s own header: a mechanic every pack presupposes, not content.
  barrels: [
    { path: 'src/game/gameObject/coreSpells/index.ts', importBase: '@/game/gameObject/coreSpells' },
  ],
};

/**
 * Trees a pack can generate a catalogue for, selected from the CLI with
 * `--tree=<name>`. Only `riot` exists so far — `spells/index.ts` is the
 * real barrel batch 4 task 3 moved in.
 *
 * Every path below is relative to a `treeRoot` the caller supplies (see
 * this file's own header) — `packs/riot/` inside this monorepo today, but
 * this object itself no longer says so anywhere.
 */
export const PACK_SPELL_TREES = {
  riot: {
    outputPath: 'generated/spellCatalog.ts',
    modulesOutputPath: 'generated/spellModules.ts',
    // Relative, not `@/…`: the alias in `tsconfig.json` resolves only under
    // `src/`, and a pack imports its own siblings the way
    // `packs/reference/pack.ts` already does.
    barrels: [{ path: 'spells/index.ts', importBase: '../spells' }],
    // A pack barrel's `default` export is `(api: ContentApi) => SpellClass`,
    // never the class itself (`packBoundary.test.ts` forbids a pack from
    // importing `Spell` etc. any other way) — `renderSpellCatalogSource`
    // calls each factory with one real, shared `api` before `describe()`
    // ever sees it. Core's own barrels are unaffected: `BasicAttack` stays a
    // plain class, exactly as before this tree existed.
    isPackFactory: true,
    // Batch 4 task 4 moved the art and populated `packs/riot/generated/
    // assetManifest.ts` for real, so `iconKeyType` is gone: `render()`
    // defaults to `'AssetKey'` and imports it from `'./assetManifest'`,
    // riot's own sibling file, not core's — a pack-local union, not a
    // reach into core (`packBoundary.test.ts` would refuse the latter).
    // Every `iconKey` this tree generates is now checked against it.
    //
    // `describe()` needs `instance.image` — a spell's own `api.asset('spell_x')`
    // field initializer — to resolve rather than throw "Unknown asset key",
    // and `AssetManager` cannot import a pack's manifest itself
    // (`corePacksBoundary.test.ts`). `packId` and `assetManifestOutputPath`
    // below are what let `renderSpellCatalogSource` register this tree's own
    // manifest with `AssetManager` before any factory runs — the SSR-process
    // equivalent of what `bundledPack.ts` does for the real game.
    packId: 'riot',
    assetManifestOutputPath: 'generated/assetManifest.ts',
  },
};

/** No cooldown reduction, no URF — the rule-free numbers this file stores. */
const NO_MATCH_RULES = { cooldownMultiplier: 1, manaFree: false };

/**
 * Reads one spell's display fields off a throwaway instance.
 *
 * Deliberately not `preset.getSpellDisplay`: that one catches and returns a
 * placeholder, which is right in a browser and wrong in a build step. Every
 * field is also asserted rather than defaulted, so "this spell forgot a name"
 * fails here instead of shipping an empty string to the picker.
 */
function describe(id, SpellClass) {
  const instance = new SpellClass({ game: { matchRules: NO_MATCH_RULES } });

  const name = instance.name;
  if (typeof name !== 'string' || !name) throw new Error(`${id}: no name`);

  const description = instance.description;
  if (typeof description !== 'string') throw new Error(`${id}: description is not a string`);

  const coolDownMs = typeof instance.coolDown === 'number' ? instance.coolDown : 0;
  const manaCost = typeof instance.manaCost === 'number' ? instance.manaCost : 0;

  // `Spell.effectiveCoolDownMs` reads `castSpec.cooldown.durationMs`, not
  // `coolDown` — for most spells the same number, but not all, and the picker
  // must show the one a countdown will actually run. Under a multiplier of 1
  // this getter *is* that duration.
  const specCoolDownMs =
    typeof instance.effectiveCoolDownMs === 'number' ? instance.effectiveCoolDownMs : 0;

  for (const [field, value] of [
    ['coolDownMs', coolDownMs],
    ['manaCost', manaCost],
    ['specCoolDownMs', specCoolDownMs],
  ]) {
    if (!Number.isFinite(value)) throw new Error(`${id}: ${field} is ${value}`);
  }

  // `image` is an `AssetHandle`, already resolved by the spell's own field
  // initializer. Its `key` is the manifest key; its `url` is a build hash.
  const handle = instance.image;
  const iconKey = handle && typeof handle.key === 'string' ? handle.key : null;

  return { id, name, description, iconKey, coolDownMs, manaCost, specCoolDownMs };
}

export async function renderSpellCatalogSource(tree = CORE_SPELL_TREE, treeRoot = coreRoot) {
  const server = await createServer({
    root: coreRoot,
    configFile: resolve(coreRoot, 'vite.config.ts'),
    logLevel: 'error',
    // `/@fs/` reaches outside `root` (see this file's header) — `fs.allow`
    // is the boundary that would otherwise refuse it. `coreRoot` is always
    // needed (ContentApi.ts, AssetManager.ts); `treeRoot` only when it is a
    // different directory, which the `Set` collapses back to one entry for
    // core's own tree.
    server: {
      middlewareMode: true,
      hmr: false,
      fs: { allow: [...new Set([coreRoot, treeRoot])] },
    },
    appType: 'custom',
  });

  try {
    // Content-last: an earlier barrel's id can never shadow a later one's —
    // core's own two barrels are `tree.barrels` in that order, matching
    // `renderSpellModulesSource`.
    let AllSpells = {};
    for (const barrel of tree.barrels) {
      const loaded = await server.ssrLoadModule(`/@fs/${resolve(treeRoot, barrel.path)}`);
      AllSpells = { ...AllSpells, ...loaded };
    }
    // A pack barrel hands over factories; resolve each against one shared,
    // real `api` — the same object every real spell in the pack would be
    // built against at runtime — before `describe()` ever sees a class.
    const api = tree.isPackFactory
      ? (await server.ssrLoadModule('/src/content/ContentApi.ts')).buildContentApi()
      : null;
    // Every spell's `image = api.asset('spell_x')` field initializer runs the
    // moment `describe()` constructs it, so this tree's own art has to be
    // registered with `AssetManager` first — the real game gets this from
    // `bundledPack.ts`'s module-level `registerPackAssets` call, which this
    // SSR process never imports (it loads only the spell barrel and
    // `ContentApi.ts`, not the whole content-registry bridge).
    if (tree.assetManifestOutputPath) {
      const AssetManagerModule = await server.ssrLoadModule('/src/managers/AssetManager.ts');
      const { assetManifest: packAssetManifest } = await server.ssrLoadModule(
        `/@fs/${resolve(treeRoot, tree.assetManifestOutputPath)}`
      );
      AssetManagerModule.default.registerPackAssets(tree.packId, packAssetManifest);
    }
    const entries = Object.entries(AllSpells)
      .filter(([, value]) => typeof value === 'function')
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([id, factoryOrClass]) => {
        const SpellClass = tree.isPackFactory ? factoryOrClass(api) : factoryOrClass;
        return describe(id, SpellClass);
      });

    if (!entries.length) throw new Error('the spell barrel exported no classes');
    return render(entries, tree);
  } finally {
    await server.close();
  }
}

function render(entries, tree = CORE_SPELL_TREE) {
  const records = entries.map(
    entry =>
      `  ${JSON.stringify(entry.id)}: {\n` +
      `    name: ${JSON.stringify(entry.name)},\n` +
      `    description: ${JSON.stringify(entry.description)},\n` +
      `    iconKey: ${JSON.stringify(entry.iconKey)},\n` +
      `    coolDownMs: ${entry.coolDownMs},\n` +
      `    manaCost: ${entry.manaCost},\n` +
      `    specCoolDownMs: ${entry.specCoolDownMs},\n` +
      `  },`
  );

  return [
    '// Generated by scripts/generate-spell-catalog.mjs. Do not edit.',
    '//',
    "// Every spell's display data as plain values, so the pregame screen can render",
    '// the roster without importing a spell class. See the generator for why, and',
    '// `src/game/config/spellCatalog.ts` for how match rules are reapplied on top.',
    '',
    tree.iconKeyType ? '' : "import type { AssetKey } from './assetManifest';",
    '',
    'export interface GeneratedSpellDisplay {',
    '  readonly name: string;',
    '  /** Vietnamese HTML — `<span class="damage">`/`.buff`/`.time`/plain `<span>`. */',
    '  readonly description: string;',
    '  /**',
    "   * The icon's manifest key, resolved through `AssetManager.get` — never a",
    '   * built URL, which is a content hash and would drag this file into every',
    '   * rebuild that touched an image. Typed against the *other* generated file,',
    '   * so renaming an icon without renaming it here is a compile error —',
    "   * unless this tree has no manifest of its own yet, see the tree config's",
    '   * own `iconKeyType` doc comment.',
    '   */',
    `  readonly iconKey: ${tree.iconKeyType ?? 'AssetKey'} | null;`,
    "  /** The spell's own tuning number, before match rules. */",
    '  readonly coolDownMs: number;',
    "  /** The spell's own tuning number, before match rules. */",
    '  readonly manaCost: number;',
    '  /** `castSpec.cooldown.durationMs` — what a countdown runs before CDR. */',
    '  readonly specCoolDownMs: number;',
    '}',
    '',
    'export const spellCatalog = {',
    ...records,
    '} as const satisfies Record<string, GeneratedSpellDisplay>;',
    '',
    '/**',
    " * Every catalogue id — the spell barrel's own export names.",
    ' *',
    ' * This is what makes a mistyped id a compile error rather than a silently',
    ' * missing ability: `config/spellCatalog.ts` types `CHAMPION_KITS` as these.',
    ' */',
    'export type SpellCatalogId = keyof typeof spellCatalog;',
    '',
  ].join('\n');
}

/**
 * The other half: `id → () => import('./Yasuo_Q')`, so a match can fetch the
 * kits it is actually about to play instead of the whole barrel.
 *
 * Parsed out of each barrel in `tree.barrels` rather than guessed from the
 * id, because a barrel is the thing that decides which file and which
 * directory an id names — `BasicAttack` is `coreSpells/BasicAttack`,
 * `Yasuo_Q` is `spells/Yasuo_Q`, and nothing guarantees id and path always
 * agree in future. The barrels are independent `readFile`s (this function
 * never touches `ssrLoadModule`), so a barrel's own `importBase` travels
 * with each of its entries directly — the old two-barrel-only version
 * built a separate `coreIds` set for the same purpose, which does not
 * generalise past two.
 *
 * The importers stay `() => import(...)` thunks rather than a resolved map:
 * Rollup only treats a dynamic import as a split point if it is literal and
 * unexecuted at module scope, so writing them any other way silently collapses
 * this file back into one eager chunk.
 */
export async function renderSpellModulesSource(tree = CORE_SPELL_TREE, treeRoot = coreRoot) {
  const pattern = /export\s*\{\s*default\s+as\s+([A-Za-z0-9_]+)\s*\}\s*from\s*'(\.\/[^']+)'/g;
  const parseBarrel = async path => {
    const source = await readFile(path, 'utf8');
    return [...source.matchAll(pattern)].map(([, id, importPath]) => ({ id, path: importPath }));
  };

  const barrels = await Promise.all(
    tree.barrels.map(async barrel => {
      const absolutePath = resolve(treeRoot, barrel.path);
      const entries = await parseBarrel(absolutePath);
      if (!entries.length) {
        throw new Error(`no \`export { default as X } from\` lines in ${absolutePath}`);
      }
      return { importBase: barrel.importBase, entries };
    })
  );

  // Content-last, matching `renderSpellCatalogSource`: a later barrel's id
  // can never be shadowed by an earlier one's.
  const merged = new Map();
  for (const barrel of barrels) {
    for (const entry of barrel.entries) {
      merged.set(entry.id, { ...entry, importBase: barrel.importBase });
    }
  }

  const entries = [...merged.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );

  const records = entries.map(
    entry =>
      `  ${JSON.stringify(entry.id)}: () => import('${entry.importBase}/${entry.path.slice(2)}'),`
  );

  return [
    '// Generated by scripts/generate-spell-catalog.mjs. Do not edit.',
    '//',
    '// One dynamic import per spell, so a match loads the kits in play rather',
    '// than all of them. `src/game/spellRegistry.ts` is the read side.',
    '',
    '/** A spell module, as the barrel re-exports it: the class on `default`. */',
    'export interface SpellModule {',
    '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
    '  default: any;',
    '}',
    '',
    'export const spellModules: Record<string, () => Promise<SpellModule>> = {',
    ...records,
    '};',
    '',
  ].join('\n');
}

export async function generateSpellCatalog(
  check = false,
  tree = CORE_SPELL_TREE,
  treeRoot = coreRoot
) {
  const [catalog, modules] = await Promise.all([
    renderSpellCatalogSource(tree, treeRoot),
    renderSpellModulesSource(tree, treeRoot),
  ]);
  const outputs = [
    { path: resolve(treeRoot, tree.outputPath), source: catalog },
    { path: resolve(treeRoot, tree.modulesOutputPath), source: modules },
  ];

  if (check) {
    for (const { path, source } of outputs) {
      const current = await readFile(path, 'utf8').catch(() => '');
      if (current !== source) {
        throw new Error(
          `Generated ${path.endsWith('spellModules.ts') ? 'spell module map' : 'spell catalog'} is stale. Run npm run catalog:generate.`
        );
      }
    }
    return;
  }

  await mkdir(dirname(outputs[0].path), { recursive: true });
  for (const { path, source } of outputs) await writeFile(path, source);
}

// `realpathSync`, not a bare `resolve()`: this file is also reachable as
// `node_modules/.bin/moba2d-generate-spell-catalog`, an npm-managed symlink,
// and Node resolves `import.meta.url` (hence `scriptPath`) to the real file
// it points at while leaving `process.argv[1]` as the symlink path itself —
// a plain string comparison never matches, and this block silently never
// runs. See this file's own header for how that was found.
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
  const treeArg = process.argv.find(arg => arg.startsWith('--tree='));
  const treeName = treeArg?.slice('--tree='.length);
  const tree = treeName ? PACK_SPELL_TREES[treeName] : CORE_SPELL_TREE;
  const rootArg = process.argv.find(arg => arg.startsWith('--root='));
  const rootValue = rootArg?.slice('--root='.length);

  if (treeName && !tree) {
    console.error(
      `Unknown spell tree "${treeName}". Known: ${Object.keys(PACK_SPELL_TREES).join(', ')}`
    );
    process.exitCode = 1;
  } else if (treeName && !rootValue) {
    // A named tree has no root of its own any more (see this file's own
    // header) — the caller must say where it lives, resolved from *its*
    // current directory, not from wherever this script happens to sit.
    console.error(
      `--tree=${treeName} requires --root=<path>, resolved from the current directory.`
    );
    process.exitCode = 1;
  } else {
    // `resolve()` with one argument resolves against `process.cwd()` —
    // exactly the portability property this fix is for: a sibling
    // repository's own shell, not this script's install location.
    const treeRoot = rootValue ? resolve(rootValue) : coreRoot;
    generateSpellCatalog(process.argv.includes('--check'), tree, treeRoot).catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
