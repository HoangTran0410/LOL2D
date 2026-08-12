import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../generate-assets.mjs';
import { createMediaWikiClient } from './mediawiki.mjs';
import { assertPcSource, championSkillForms, parseLuaData } from './lua-data.mjs';
import { normalizeAbilityFields } from './normalize.mjs';

const ALL_SLOTS = ['I', 'Q', 'W', 'E', 'R'];

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  }
  return value;
}

export function deterministicJson(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : deterministicJson(value)).digest('hex');
}

export function championSlug(name) {
  if (typeof name !== 'string' || !name || !/^[\p{L}\p{N} .'-]+$/u.test(name)) {
    throw new Error(`Invalid champion name: ${name}`);
  }
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error(`Invalid champion name: ${name}`);
  return slug;
}

function sourceRecord(source, fetchedAt, content) {
  return {
    pageUrl: source.pageUrl,
    revisionId: source.revisionId,
    sourceTimestamp: source.timestamp,
    fetchedAt,
    contentHash: hash(content),
  };
}

function imageExtension(mime, url) {
  const known = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime];
  if (known) return known;
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return extension === '.jpeg' ? '.jpg' : extension;
  throw new Error(`Unsupported image type: ${mime}`);
}

function validateImage(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) throw new Error('Downloaded image is empty');
  const valid = mime === 'image/png'
    ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : mime === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8
      : mime === 'image/gif'
        ? new TextDecoder().decode(bytes.slice(0, 3)) === 'GIF'
        : mime === 'image/webp'
          ? new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
          : false;
  if (!valid) throw new Error(`Downloaded bytes do not match ${mime}`);
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function commitFiles(root, files) {
  const parent = dirname(root);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, '.wiki-import-'));
  try {
    for (const [path, contents] of files) {
      const staged = join(stage, path);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, contents);
    }
    for (const [path] of files) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(stage, path), destination);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function findChampion(index, requested) {
  const entry = Object.entries(index).find(([key, champion]) =>
    key.toLowerCase() === requested.toLowerCase() || champion?.name?.toLowerCase() === requested.toLowerCase()
  );
  if (!entry) throw new Error(`Champion not found in PC index: ${requested}`);
  return { key: entry[0], value: entry[1] };
}

function changedFields(previous, next) {
  const changes = [];
  const fields = new Set([
    ...(previous?.forms ?? []).flatMap(form => Object.keys(form.fields ?? {})),
    ...(next?.forms ?? []).flatMap(form => Object.keys(form.fields ?? {})),
  ]);
  for (const field of [...fields].sort()) {
    const oldValues = previous?.forms?.map(form => form.fields?.[field]) ?? [];
    const newValues = next?.forms?.map(form => form.fields?.[field]) ?? [];
    if (hash(oldValues) !== hash(newValues)) changes.push(`fields.${field}`);
  }
  return changes;
}

async function readJson(path, fallback) {
  return JSON.parse(await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return JSON.stringify(fallback);
    throw error;
  }));
}

export async function importAbilities({
  root,
  champions,
  all = false,
  slots = ALL_SLOTS,
  update = false,
  client = createMediaWikiClient(),
  now = () => new Date().toISOString(),
  log = console.log,
}) {
  const indexSource = await client.fetchChampionIndex();
  assertPcSource(indexSource.pageUrl);
  const index = parseLuaData(indexSource.source);
  const requested = all ? Object.keys(index) : champions;
  if (!requested?.length) throw new Error('Select champions with --champion, --champions, or --all');

  const fetchedAt = now();
  const normalizedIndex = { schemaVersion: 1, source: sourceRecord(indexSource, fetchedAt, index), champions: index };
  const rawIndex = { schemaVersion: 1, source: sourceRecord(indexSource, fetchedAt, indexSource.source), payload: indexSource.source };
  const outputs = [
    ['docs/abilities/generated/champions.json', deterministicJson(normalizedIndex)],
    ['docs/abilities/cache/raw/champions.json', deterministicJson(rawIndex)],
    ['docs/abilities/cache/normalized/champions.json', deterministicJson(normalizedIndex)],
  ];
  const manifestPath = resolve(root, 'assets/source-manifest.json');
  const manifest = await readJson(manifestPath, { schemaVersion: 1, sources: [] });
  const sourceEntries = new Map(manifest.sources.map(entry => [entry.localAssetKey, entry]));

  for (const requestedName of requested) {
    const { value: champion } = findChampion(index, requestedName);
    const name = champion.name ?? requestedName;
    const slug = championSlug(name);
    const championImage = champion.image ?? `${name.replaceAll(' ', '_')}Square.png`;
    const championImageInfo = await client.fetchImageInfo(championImage);
    const championBytes = await client.fetchBytes(championImageInfo.url);
    validateImage(championBytes, championImageInfo.mime);
    const championExtension = imageExtension(championImageInfo.mime, championImageInfo.url);
    const championAssetKey = `champ_${slug.replaceAll('-', '_')}`;
    const championLocalPath = `assets/images/champions/${slug}${championExtension}`;
    const championRecord = {
      schemaVersion: 1,
      champion: name,
      data: champion,
      source: sourceRecord(indexSource, fetchedAt, champion),
      asset: { key: championAssetKey, originalUrl: championImageInfo.url, mime: championImageInfo.mime, sha1: championImageInfo.sha1 },
    };
    const championRecordPath = resolve(root, `docs/abilities/${slug}/champion.json`);
    const previousChampion = update && await exists(championRecordPath) ? await readJson(championRecordPath, null) : null;
    if (!previousChampion || previousChampion.source?.revisionId !== championRecord.source.revisionId || previousChampion.source?.contentHash !== championRecord.source.contentHash) {
      outputs.push([relative(root, championRecordPath), deterministicJson(championRecord)]);
      outputs.push([`docs/abilities/cache/normalized/${slug}/champion.json`, deterministicJson(championRecord)]);
      outputs.push([championLocalPath, championBytes]);
      sourceEntries.set(championAssetKey, {
        localAssetKey: championAssetKey,
        localPath: championLocalPath,
        sourceUrl: championImageInfo.url,
        revisionId: indexSource.revisionId,
        fetchedAt,
        contentHash: hash(championBytes),
      });
    }
    for (const slot of slots) {
      const forms = championSkillForms(champion, slot);
      if (!forms.length) continue;
      const recordPath = resolve(root, `docs/abilities/${slug}/${slot.toLowerCase()}.json`);
      if (!update && await exists(recordPath)) throw new Error(`${name} ${slot} already exists; use ability:update`);

      const templates = await Promise.all(forms.map(form => {
        const page = `Template:Data ${name}/${form}`;
        assertPcSource(page);
        return client.fetchTemplate(page);
      }));
      const normalizedForms = templates.map((template, index) => ({
        name: forms[index],
        fields: normalizeAbilityFields(template.fields),
      }));
      const icon = normalizedForms[0].fields.icon;
      if (typeof icon !== 'string' || !icon) throw new Error(`${name} ${slot}: icon is missing`);
      const imageInfo = await client.fetchImageInfo(icon);
      const bytes = await client.fetchBytes(imageInfo.url);
      validateImage(bytes, imageInfo.mime);
      const extension = imageExtension(imageInfo.mime, imageInfo.url);
      const localAssetKey = `spell_${slug.replaceAll('-', '_')}_${slot.toLowerCase()}`;
      const localPath = `assets/images/spells/${slug}_${slot.toLowerCase()}${extension}`;
      const source = sourceRecord(templates[0], fetchedAt, normalizedForms);
      const record = {
        schemaVersion: 1,
        champion: name,
        slot,
        forms: normalizedForms,
        source,
        asset: { key: localAssetKey, originalUrl: imageInfo.url, mime: imageInfo.mime, sha1: imageInfo.sha1 },
      };
      if (update && await exists(recordPath)) {
        const previous = await readJson(recordPath, null);
        for (const field of changedFields(previous, record)) log(`${name} ${slot}: ${field} changed`);
        if (previous.source?.revisionId === record.source.revisionId && previous.source?.contentHash === record.source.contentHash) {
          log(`${name} ${slot}: unchanged`);
          continue;
        }
      }
      const rawCache = {
        schemaVersion: 1,
        source: sourceRecord(templates[0], fetchedAt, templates.map(template => template.raw ?? template.fields)),
        payload: templates.map(template => ({
          page: template.page,
          revisionId: template.revisionId,
          timestamp: template.timestamp,
          response: template.raw ?? template.fields,
        })),
      };
      outputs.push([relative(root, recordPath), deterministicJson(record)]);
      outputs.push([`docs/abilities/cache/raw/${slug}/${slot.toLowerCase()}.json`, deterministicJson(rawCache)]);
      outputs.push([`docs/abilities/cache/normalized/${slug}/${slot.toLowerCase()}.json`, deterministicJson(record)]);
      outputs.push([localPath, bytes]);
      sourceEntries.set(localAssetKey, {
        localAssetKey,
        localPath,
        sourceUrl: imageInfo.url,
        revisionId: templates[0].revisionId,
        fetchedAt,
        contentHash: hash(bytes),
      });
    }
  }
  manifest.sources = [...sourceEntries.values()].sort((a, b) => a.localAssetKey.localeCompare(b.localAssetKey));
  outputs.push(['assets/source-manifest.json', deterministicJson(manifest)]);
  await commitFiles(resolve(root), outputs);
  return outputs.map(([path]) => path);
}

export async function syncChampionIndex({ root, client = createMediaWikiClient(), now = () => new Date().toISOString() }) {
  const response = await client.fetchChampionIndex();
  const data = parseLuaData(response.source);
  const fetchedAt = now();
  const normalized = { schemaVersion: 1, source: sourceRecord(response, fetchedAt, data), champions: data };
  const raw = { schemaVersion: 1, source: sourceRecord(response, fetchedAt, response.source), payload: response.source };
  await commitFiles(resolve(root), [
    ['docs/abilities/generated/champions.json', deterministicJson(normalized)],
    ['docs/abilities/cache/raw/champions.json', deterministicJson(raw)],
    ['docs/abilities/cache/normalized/champions.json', deterministicJson(normalized)],
  ]);
}

export function parseCli(args) {
  const options = { champions: undefined, slots: ALL_SLOTS };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--index') options.index = true;
    else if (arg === '--update') options.update = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--champion' || arg === '--champions') {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      options.champions = value.split(',').map(name => name.trim());
      options.champions.forEach(championSlug);
    } else if (arg === '--slots') {
      const value = args[++index];
      if (!value) throw new Error('--slots requires a value');
      options.slots = value.toUpperCase().split(',');
      if (options.slots.some(slot => !ALL_SLOTS.includes(slot))) throw new Error(`Invalid slots: ${value}`);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.index && !options.all && !options.champions) throw new Error('Use --champion, --champions, or --all');
  if (options.all && options.champions) throw new Error('--all cannot be combined with champion selection');
  return options;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), '../..');
  Promise.resolve().then(async () => {
    const options = parseCli(process.argv.slice(2));
    if (options.index) await syncChampionIndex({ root });
    else {
      await importAbilities({ root, ...options });
      await generate(root);
    }
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
