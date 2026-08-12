import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetKeyForPath, generate } from '../generate-assets.mjs';
import { contentHash } from './import-abilities.mjs';

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
  if (value.forms) return value.forms;
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
  for (const source of manifest.sources) {
    if (!source?.localAssetKey || !source.localPath || !source.sourceUrl || !Number.isInteger(source.revisionId) || !source.fetchedAt || !/^[a-f0-9]{64}$/.test(source.contentHash)) {
      throw new Error('assets/source-manifest.json: invalid source metadata');
    }
    if (sources.has(source.localAssetKey)) throw new Error(`assets/source-manifest.json: duplicate asset key ${source.localAssetKey}`);
    if (sourcePaths.has(source.localPath)) throw new Error(`assets/source-manifest.json: duplicate local path ${source.localPath}`);
    if (assetKeyForPath(source.localPath) !== source.localAssetKey) throw new Error(`assets/source-manifest.json: asset key/path mismatch for ${source.localAssetKey}`);
    const bytes = await readFile(resolve(root, source.localPath)).catch(() => null);
    if (!bytes) throw new Error(`assets/source-manifest.json: missing image ${source.localPath}`);
    if (contentHash(bytes) !== source.contentHash) throw new Error(`assets/source-manifest.json: image hash mismatch for ${source.localAssetKey}`);
    sources.set(source.localAssetKey, source);
    sourcePaths.add(source.localPath);
  }
  const referencedAssets = new Set();

  for (const path of allFiles) {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion`);
    validateSource(value.source, path);
    if (contentHash(sourceContent(value, path)) !== value.source.contentHash) throw new Error(`${path}: content hash mismatch`);
    if (path.includes('/cache/')) continue;
    if (value.asset?.key) {
      if (!sources.has(value.asset.key)) throw new Error(`${path}: missing source-manifest entry`);
      const source = sources.get(value.asset.key);
      if (source.sourceUrl !== value.asset.originalUrl || source.revisionId !== value.source.revisionId) throw new Error(`${path}: source-manifest/record metadata mismatch`);
      const extension = expectedExtension(value.asset.mime);
      if (!extension || extname(source.localPath).toLowerCase() !== extension) throw new Error(`${path}: source-manifest MIME/path mismatch`);
      referencedAssets.add(value.asset.key);
    }
    if (!value.champion || !value.slot || !Array.isArray(value.forms) || !value.forms.length) continue;
    for (const form of value.forms) {
      const identity = `${value.champion}:${value.slot}:${form.name}`;
      if (identities.has(identity)) throw new Error(`${path}: duplicate ${identity}`);
      identities.add(identity);
    }
    if (!value.asset?.key) throw new Error(`${path}: missing asset metadata`);
  }
  for (const key of sources.keys()) {
    if (!referencedAssets.has(key)) throw new Error(`assets/source-manifest.json: unreferenced asset key ${key}`);
  }
  await generate(root, true);
  return { records: files.length, forms: identities.size };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(new URL('../..', import.meta.url).pathname);
  checkAbilities(root).then(result => console.log(`Ability data valid: ${result.records} records, ${result.forms} forms`)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
