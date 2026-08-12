import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export async function checkAbilities(root) {
  const docsRoot = resolve(root, 'docs/abilities');
  const allFiles = (await walk(docsRoot)).filter(path => path.endsWith('.json'));
  const files = allFiles.filter(path => !path.includes('/cache/'));
  const identities = new Set();
  const manifest = await readFile(resolve(root, 'assets/source-manifest.json'), 'utf8').then(JSON.parse, () => ({ sources: [] }));
  const sources = new Map(manifest.sources?.map(source => [source.localAssetKey, source]) ?? []);
  const generated = await readFile(resolve(root, 'src/generated/assetManifest.ts'), 'utf8').catch(() => '');

  for (const path of allFiles) {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion`);
    validateSource(value.source, path);
    if (path.includes('/cache/')) continue;
    if (value.asset?.key) {
      if (!sources.has(value.asset.key)) throw new Error(`${path}: missing source-manifest entry`);
      const source = sources.get(value.asset.key);
      if (!await stat(resolve(root, source.localPath)).then(() => true, () => false)) throw new Error(`${path}: missing image ${source.localPath}`);
      if (generated && !generated.includes(JSON.stringify(value.asset.key))) throw new Error(`${path}: generated asset key is missing`);
    }
    if (!value.champion || !value.slot || !Array.isArray(value.forms) || !value.forms.length) continue;
    for (const form of value.forms) {
      const identity = `${value.champion}:${value.slot}:${form.name}`;
      if (identities.has(identity)) throw new Error(`${path}: duplicate ${identity}`);
      identities.add(identity);
    }
    if (!value.asset?.key) throw new Error(`${path}: missing asset metadata`);
  }
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
