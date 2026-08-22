import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);
const URL_EXTENSIONS = new Set(['.cur']);
/**
 * Files under `assets/` the manifest must never mint a key for, even though
 * `walk()` would otherwise find them.
 *
 *  - `assets/sounds/index.js` is a legacy source file that happens to sit
 *    under `assets/`, not an asset — it was never meant to gain a `?url`
 *    import.
 *  - `assets/source-manifest.json` is build *provenance* — where each
 *    imported ability image came from on the wiki, and its content hash —
 *    written and read only by `scripts/wiki/*`. Same class as the line
 *    above: a file that happens to sit under `assets/`, not an asset. It
 *    had a `source_manifest` key nothing ever called, and that key is what
 *    put 113 KB of Riot image provenance into the *engine's* generated
 *    manifest and therefore into `@moba2d/core`'s published tarball —
 *    content-pack-extraction batch 5, whole-branch review, Q1.
 *    `tests/content/corePackTarball.test.ts` is what keeps it out now.
 *
 * `assets/json/summoner_map.json` used to need an entry here for the same
 * reason: it is a real asset, but `summonersRiftGeometry.ts` has always read
 * it directly as raw text (a `?raw` import, parsed as JSON in that module),
 * never through `AssetManager`, so minting a `json_summoner_map` entry
 * nobody called would ship the same 22,180 bytes twice — once inlined into
 * `map-summonersrift-*.js` by the `?raw` import, once again as
 * `dist/assets/summoner_map-*.json`, and the service worker would precache
 * both. Batch 4 task 6 moved the file to `packs/riot/maps/summoner_map.json`
 * — outside every asset tree this generator walks — so the exclusion is
 * gone rather than duplicated: `walk()` simply never finds it there.
 */
const MANIFEST_EXCLUDED_FILES = new Set([
  'assets/sounds/index.js',
  'assets/source-manifest.json',
]);

function normalizePart(value) {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function assetKeyForPath(inputPath) {
  const path = inputPath.replaceAll('\\', '/');
  const withoutExtension = path.slice(0, -extname(path).length);
  const relativePath = withoutExtension.replace(/^.*?assets\//, '');
  const parts = relativePath.split('/');

  if (parts[0] === 'images') parts.shift();

  let prefix = normalizePart(parts.shift() ?? 'asset');
  if (prefix === 'champions') {
    prefix = parts[0] === 'background' ? `champ_${normalizePart(parts.shift())}` : 'champ';
  } else {
    prefix =
      {
        buffs: 'buff',
        cursors: 'cursor',
        monsters: 'monster',
        objects: 'obj',
        others: 'other',
        screenshots: 'screenshot',
        sounds: 'sound',
        spells: 'spell',
      }[prefix] ?? prefix;
  }

  return [prefix, ...parts.map(normalizePart)].filter(Boolean).join('_');
}

function assetKind(path) {
  const extension = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (extension === '.json') return 'json';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (URL_EXTENSIONS.has(extension)) return 'url';
  throw new Error(`Unsupported asset file: ${path}`);
}

/**
 * `keyPrefix` lets a second tree's asset keys avoid colliding with the first
 * tree's — two packs can each have `assets/images/champions/janna.png` and
 * would otherwise both mint `champ_janna`. Empty by default: core needs none,
 * and what a given pack's prefix should actually be is that pack's own
 * decision (batch 4 task 4), not this function's.
 */
export function buildManifestEntries(paths, { keyPrefix = '' } = {}) {
  const entries = paths
    .map(path => path.replaceAll('\\', '/'))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map(path => ({ key: `${keyPrefix}${assetKeyForPath(path)}`, kind: assetKind(path), path }));
  const seen = new Map();

  for (const entry of entries) {
    const duplicate = seen.get(entry.key);
    if (duplicate) {
      throw new Error(`Duplicate asset key "${entry.key}": ${duplicate}, ${entry.path}`);
    }
    seen.set(entry.key, entry.path);
  }

  return entries;
}

/**
 * `importPrefix` is how far the generated file has to walk, from its own
 * directory, back to the repository root that every entry's `path` is
 * written relative to. `../../` for core's `src/generated/` (two segments
 * down); a tree whose output lives deeper, like `packs/riot/generated/`,
 * needs a longer one — see `importPrefixFor`, the only caller that computes
 * it. A bare call (as every existing test makes) keeps the old, hardcoded
 * default, so this is a widening, not a behaviour change.
 */
export function renderManifest(entries, { importPrefix = '../../' } = {}) {
  const imports = entries.map((entry, index) => {
    const importPath = `${importPrefix}${entry.path}?url`;
    return `import asset${index}Url from '${importPath}';`;
  });
  const records = entries.map(
    (entry, index) =>
      `  ${JSON.stringify(entry.key)}: { kind: '${entry.kind}', url: asset${index}Url, path: ${JSON.stringify(entry.path)} },`
  );

  return [
    '// Generated by scripts/generate-assets.mjs. Do not edit.',
    ...imports,
    '',
    "export type AssetKind = 'image' | 'json' | 'audio' | 'url';",
    '',
    'export const assetManifest = {',
    ...records,
    '} as const;',
    '',
    'export type AssetKey = keyof typeof assetManifest;',
    '',
  ].join('\n');
}

async function walk(directory, root) {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(absolutePath, root)));
    else {
      const path = relative(root, absolutePath).replaceAll('\\', '/');
      if (!MANIFEST_EXCLUDED_FILES.has(path)) paths.push(path);
    }
  }
  return paths;
}

/**
 * The tree this generator has always walked: `assets/` at the repository
 * root, written to `src/generated/assetManifest.ts`. Every caller —
 * `renderAssetManifestSource(root, { add, remove })`, `generate(root,
 * check)`, `npm run assets:generate` — passes no tree at all and gets this
 * one.
 *
 * A second tree, `packs/riot/`'s own, used to live alongside this one as
 * `PACK_ASSET_TREES.riot`, selected from the CLI with `--tree=riot`.
 * Content-pack-extraction batch 5 task 5 moved it out: the asset walk has
 * zero core dependency, so the pack now carries its own full copy —
 * `packs/riot/scripts/generate-assets.mjs` — rather than reaching back into
 * this file, which keeps working (and stays extractable on its own) even
 * with no core checkout beside it. `--tree=` is gone from this CLI along
 * with it — a flag nothing still passes is a trap for the next reader.
 */
export const CORE_ASSET_TREE = {
  assetsDir: 'assets',
  outputPath: 'src/generated/assetManifest.ts',
  keyPrefix: '',
  regenerateCommand: 'npm run assets:generate',
};

/**
 * How far a tree's generated file must walk back to the repository root
 * that every manifest entry's `path` is written relative to — `../../` for
 * `src/generated/` (two segments down), `../../../` for the one-segment-
 * deeper `packs/riot/generated/`. Computed from the tree's own `outputPath`
 * rather than hard-coded, so a tree whose output lives somewhere else still
 * gets working imports.
 */
function importPrefixFor(root, outputPath) {
  const outputDir = dirname(resolve(root, outputPath));
  const toRoot = relative(outputDir, root).replaceAll('\\', '/');
  return toRoot === '' ? './' : `${toRoot}/`;
}

export async function renderAssetManifestSource(
  root,
  { add = [], remove = [], tree = CORE_ASSET_TREE } = {}
) {
  const { assetsDir, outputPath, keyPrefix } = tree;
  const paths = new Set(await walk(resolve(root, assetsDir), root));
  for (const path of remove) paths.delete(path.replaceAll('\\', '/'));
  for (const path of add) {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.startsWith(`${assetsDir}/`) && !MANIFEST_EXCLUDED_FILES.has(normalized))
      paths.add(normalized);
  }
  const entries = buildManifestEntries([...paths], { keyPrefix });
  return renderManifest(entries, { importPrefix: importPrefixFor(root, outputPath) });
}

export async function generate(root, check = false, tree = CORE_ASSET_TREE) {
  const outputPath = resolve(root, tree.outputPath);
  const source = await renderAssetManifestSource(root, { tree });

  if (check) {
    const current = await readFile(outputPath, 'utf8').catch(() => '');
    if (current !== source)
      throw new Error(`Generated asset manifest is stale. Run ${tree.regenerateCommand}.`);
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), '..');
  generate(root, process.argv.includes('--check')).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
