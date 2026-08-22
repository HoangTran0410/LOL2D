import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetKeyForPath, generate } from '../generate-assets.mjs';
import { contentHash } from './import-abilities.mjs';
import { existsSync } from 'node:fs';

/**
 * The pack a manifest entry's file belongs to, or `null` for one of core's own.
 *
 * Paired with `packTreeIsPresent` below, and the pair deliberately does **not**
 * answer "is this pack installed" — that question has exactly one home,
 * `scripts/installed-packs.mjs`, and a second answer to it would be a source of
 * drift. This asks something different and narrower: does the root *being
 * validated* contain that pack's tree. `checkAbilities(root)` is called with
 * temporary fixture roots by `tests/wiki/import-abilities.test.ts`, which build
 * a `packs/riot/assets/` of their own and have no `node_modules` at all, so
 * "installed" is not even a meaningful question there — while "is the file this
 * manifest row names supposed to be here" is, and is the one this check needs.
 *
 * `assets/source-manifest.json` is core's file and records the wiki provenance
 * of every downloaded image — but batch 4 task 4 moved 377 of those images into
 * `packs/riot/assets/`, so most of its rows now name a file that only exists
 * when that pack is installed. Content-pack-extraction batch 5 task 8's drill
 * is what surfaced it: with `packs/riot/` moved out of the tree, `ability:check`
 * died on `missing image packs/riot/assets/images/champions/alistar.png` — a
 * check over `docs/abilities/`, which is core's own tree, failing over a file
 * that had no business being required.
 */
const packOfPath = localPath => /^packs\/([A-Za-z0-9_-]+)\//.exec(localPath)?.[1] ?? null;

/** Does `root` — whichever root this run was pointed at — hold that pack's tree? */
const packTreeIsPresent = (root, pack) => existsSync(resolve(root, 'packs', pack));

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]))).flat();
}

function validateSource(source, path) {
  if (!source || !Number.isInteger(source.revisionId) || !source.pageUrl || !source.sourceTimestamp || !source.fetchedAt || !source.contentHash) {
    throw new Error(`${path}: invalid source metadata`);
  }
  if (Number.isNaN(Date.parse(source.sourceTimestamp)) || Number.isNaN(Date.parse(source.fetchedAt)) || !/^[a-f0-9]{64}$/.test(source.contentHash)) {
    throw new Error(`${path}: invalid source timestamp or hash`);
  }
}

function sourceContent(value, path) {
  // Forms carry a per-form `asset` (icon download metadata) that is not part of
  // the wiki text the record's contentHash tracks, so it is excluded here.
  if (value.forms) return value.forms.map(form => ({ name: form.name, fields: form.fields }));
  if (value.data) return value.data;
  if (value.champions) return value.champions;
  if (value.payload !== undefined) {
    if (path.includes('/cache/raw/') && Array.isArray(value.payload)) {
      return value.payload.map(item => item.response);
    }
    return value.payload;
  }
  throw new Error(`${path}: source content is missing`);
}

function expectedExtension(mime) {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime];
}

export async function checkAbilities(root) {
  const docsRoot = resolve(root, 'docs/abilities');
  const allFiles = (await walk(docsRoot)).filter(path => path.endsWith('.json'));
  const files = allFiles.filter(path => !path.includes('/cache/'));
  const identities = new Set();
  const manifest = await readFile(resolve(root, 'assets/source-manifest.json'), 'utf8').then(JSON.parse, () => ({ sources: [] }));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) throw new Error('assets/source-manifest.json: invalid schema');
  const sources = new Map();
  const sourcePaths = new Set();
  /** pack name -> how many of its images this run could not read, because it is not installed. */
  const skippedByPack = new Map();
  for (const source of manifest.sources) {
    if (!source?.localAssetKey || !source.localPath || !source.sourceUrl || !Number.isInteger(source.revisionId) || !source.fetchedAt || !/^[a-f0-9]{64}$/.test(source.contentHash)) {
      throw new Error('assets/source-manifest.json: invalid source metadata');
    }
    if (sources.has(source.localAssetKey)) throw new Error(`assets/source-manifest.json: duplicate asset key ${source.localAssetKey}`);
    if (sourcePaths.has(source.localPath)) throw new Error(`assets/source-manifest.json: duplicate local path ${source.localPath}`);
    if (assetKeyForPath(source.localPath) !== source.localAssetKey) throw new Error(`assets/source-manifest.json: asset key/path mismatch for ${source.localAssetKey}`);
    // Every *metadata* check above runs for every row, installed or not — the
    // schema, the key/path agreement, the duplicate detection. Only the two
    // that need the bytes on disk are conditional, and only on the pack that
    // owns them genuinely not being installed. A pack that *is* here and is
    // missing a file it declares still fails, loudly, exactly as before.
    const pack = packOfPath(source.localPath);
    if (pack && !packTreeIsPresent(root, pack)) {
      skippedByPack.set(pack, (skippedByPack.get(pack) ?? 0) + 1);
    } else {
      const bytes = await readFile(resolve(root, source.localPath)).catch(() => null);
      if (!bytes) throw new Error(`assets/source-manifest.json: missing image ${source.localPath}`);
      if (contentHash(bytes) !== source.contentHash) throw new Error(`assets/source-manifest.json: image hash mismatch for ${source.localAssetKey}`);
    }
    sources.set(source.localAssetKey, source);
    sourcePaths.add(source.localPath);
  }
  const referencedAssets = new Set();

  function checkAssetRef(path, asset, recordSource) {
    if (!sources.has(asset.key)) throw new Error(`${path}: missing source-manifest entry`);
    const source = sources.get(asset.key);
    if (source.sourceUrl !== asset.originalUrl || source.revisionId !== recordSource.revisionId) throw new Error(`${path}: source-manifest/record metadata mismatch`);
    const extension = expectedExtension(asset.mime);
    if (!extension || extname(source.localPath).toLowerCase() !== extension) throw new Error(`${path}: source-manifest MIME/path mismatch`);
    referencedAssets.add(asset.key);
  }

  for (const path of allFiles) {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion`);
    validateSource(value.source, path);
    if (contentHash(sourceContent(value, path)) !== value.source.contentHash) throw new Error(`${path}: content hash mismatch`);
    if (path.includes('/cache/')) continue;
    if (value.asset?.key) checkAssetRef(path, value.asset, value.source);
    if (!value.champion || !value.slot || !Array.isArray(value.forms) || !value.forms.length) continue;
    for (const form of value.forms) {
      const identity = `${value.champion}:${value.slot}:${form.name}`;
      if (identities.has(identity)) throw new Error(`${path}: duplicate ${identity}`);
      identities.add(identity);
      // Multi-form abilities download a separate icon per form; validate each one
      // that the importer attached (older cached records may still be single-icon).
      if (form.asset?.key) checkAssetRef(path, form.asset, value.source);
    }
    if (!value.asset?.key) throw new Error(`${path}: missing asset metadata`);
  }
  for (const key of sources.keys()) {
    if (!referencedAssets.has(key)) throw new Error(`assets/source-manifest.json: unreferenced asset key ${key}`);
  }
  await generate(root, true);
  return { records: files.length, forms: identities.size, skippedByPack };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(new URL('../..', import.meta.url).pathname);
  checkAbilities(root).then(result => {
    // The skip is reported, never silent: a run that checked 378 fewer images
    // than the last one has to say so, or "ability data valid" means something
    // different from one checkout to the next with nothing to show for it.
    const skipped = [...result.skippedByPack].map(([pack, count]) => `${count} from ${pack} (not installed)`);
    console.log(
      `Ability data valid: ${result.records} records, ${result.forms} forms` +
        (skipped.length ? ` — images unchecked: ${skipped.join(', ')}` : '')
    );
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
