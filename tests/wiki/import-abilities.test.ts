import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaWikiClient } from '../../scripts/wiki/mediawiki.mjs';
import {
  importAbilities,
  parseCli,
  syncChampionIndex,
} from '../../scripts/wiki/import-abilities.mjs';
import { normalizeAbilityFields, renderFieldRequest } from '../../scripts/wiki/normalize.mjs';
import { checkAbilities } from '../../scripts/wiki/check-abilities.mjs';

const fixtureUrl = new URL('../fixtures/wiki/janna-howling-gale.json', import.meta.url);
const roots: string[] = [];

async function root() {
  const path = await mkdtemp(join(tmpdir(), 'lol2d-wiki-'));
  roots.push(path);
  return path;
}

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function client(data: Awaited<ReturnType<typeof fixture>>, overrides = {}) {
  return {
    fetchChampionIndex: vi.fn(async () => ({
      source: 'return { Janna = { name = "Janna", image = "JannaSquare.png", skill_q = { "Howling Gale", "Howling Gale Recast" } } }',
      revisionId: 100,
      timestamp: '2026-08-12T00:00:00Z',
      pageUrl: 'https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data',
    })),
    fetchTemplate: vi.fn(async () => ({
      page: 'Template:Data Janna/Howling Gale',
      revisionId: data.revision.query.pages[0].revisions[0].revid,
      timestamp: data.revision.query.pages[0].revisions[0].timestamp,
      fields: data.expanded.expandtemplates.wikitext,
      raw: { revision: data.revision, expanded: data.expanded },
      pageUrl: 'https://wiki.leagueoflegends.com/en-us/Template:Data_Janna/Howling_Gale',
    })),
    fetchImageInfo: vi.fn(async file => file.includes('JannaSquare') ? {
      url: 'https://wiki.leagueoflegends.com/images/JannaSquare.png',
      sha1: 'fedcba9876543210',
      mime: 'image/png',
    } : data.imageinfo.query.pages[0].imageinfo[0]),
    fetchBytes: vi.fn(async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('League Wiki importer', () => {
  it('uses the documented pst2 selector and verified source parameter aliases', () => {
    const request = renderFieldRequest('Template:Data Lux/Final Spark');

    expect(request).toContain('@@name@@{{Template:Data Lux/Final Spark|pst2|1}}');
    expect(request).toContain('@@icon@@{{Template:Data Lux/Final Spark|pst2|icon}}');
    expect(request).toContain('@@casttime@@{{Template:Data Lux/Final Spark|pst2|cast time}}');
    expect(request).toContain('@@effectradius@@{{Template:Data Lux/Final Spark|pst2|effect radius}}');
    expect(request).toContain('@@radius@@{{Template:Data Lux/Final Spark|pst2|radius}}');
    expect(normalizeAbilityFields('@@name@@Final Spark@@icon@@Final Spark.png@@casttime@@1@@effectradius@@@@radius@@@@')).toEqual({
      name: 'Final Spark',
      icon: 'Final Spark.png',
      casttime: '1',
    });
  });

  it('normalizes selected fields and preserves raw formulas', async () => {
    const data = await fixture();
    const fields = normalizeAbilityFields(data.expanded.expandtemplates.wikitext);

    expect(fields.description).toEqual({
      raw: "'''Active:''' Janna summons a [[File:Airborne icon.png|20px]] whirlwind dealing {{as|magic damage}}.",
      text: 'Active: Janna summons a whirlwind dealing magic damage.',
    });
    expect(fields.leveling).toMatchObject({ raw: expect.stringContaining('60 / 85'), text: expect.stringContaining('60 / 85') });
    expect(fields.range).toBe('1100 - 1760');
    expect(fields.projectile).toBe(true);
  });

  it('writes deterministic raw and normalized caches with source metadata', async () => {
    const data = await fixture();
    const target = await root();

    await importAbilities({ root: target, champions: ['Janna'], slots: ['Q'], client: client(data), now: () => '2026-08-13T00:00:00.000Z' });

    const record = JSON.parse(await readFile(join(target, 'docs/abilities/janna/q.json'), 'utf8'));
    const raw = JSON.parse(await readFile(join(target, 'docs/abilities/cache/raw/janna/q.json'), 'utf8'));
    const champion = JSON.parse(await readFile(join(target, 'docs/abilities/janna/champion.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(target, 'assets/source-manifest.json'), 'utf8'));
    expect(record).toMatchObject({
      schemaVersion: 1,
      champion: 'Janna',
      slot: 'Q',
      forms: [
        { name: 'Howling Gale', fields: { range: '1100 - 1760' } },
        { name: 'Howling Gale Recast', fields: { range: '1100 - 1760' } },
      ],
      source: { revisionId: 456, fetchedAt: '2026-08-13T00:00:00.000Z', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      asset: { key: 'spell_janna_q', originalUrl: 'https://wiki.leagueoflegends.com/images/Howling_Gale.png' },
    });
    expect(raw).toMatchObject({
      schemaVersion: 1,
      source: { revisionId: 456 },
      payload: [
        { page: 'Template:Data Janna/Howling Gale', response: { revision: data.revision, expanded: data.expanded } },
        { page: 'Template:Data Janna/Howling Gale', response: { revision: data.revision, expanded: data.expanded } },
      ],
    });
    expect(champion).toMatchObject({ schemaVersion: 1, champion: 'Janna', asset: { key: 'champ_janna' } });
    expect(await readFile(join(target, 'assets/images/spells/janna_q.png'))).toHaveLength(8);
    expect(await readFile(join(target, 'assets/images/champions/janna.png'))).toHaveLength(8);
    expect(manifest.sources.find((source: { localAssetKey: string }) => source.localAssetKey === 'spell_janna_q').contentHash).toBe(
      createHash('sha256').update(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).digest('hex')
    );

    await mkdir(join(target, 'src/generated'), { recursive: true });
    await writeFile(join(target, 'src/generated/assetManifest.ts'), 'export const assetManifest = { "champ_janna": {}, "spell_janna_q": {} };\n');
    await expect(checkAbilities(target)).resolves.toEqual({ records: 3, forms: 2 });
    raw.source.fetchedAt = 'invalid';
    await writeFile(join(target, 'docs/abilities/cache/raw/janna/q.json'), JSON.stringify(raw));
    await expect(checkAbilities(target)).rejects.toThrow(/source timestamp/i);
  });

  it('writes nothing when any fetch or validation step fails', async () => {
    const data = await fixture();
    const target = await root();
    await writeFile(join(target, 'existing.txt'), 'keep me');
    const failing = client(data, { fetchBytes: vi.fn(async () => { throw new Error('offline'); }) });

    await expect(importAbilities({ root: target, champions: ['Janna'], slots: ['Q'], client: failing, now: () => '2026-08-13T00:00:00.000Z' })).rejects.toThrow(/offline/);
    await expect(readdir(target)).resolves.toEqual(['existing.txt']);
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('keep me');
  });

  it('does not overwrite an existing champion record when importing another slot', async () => {
    const data = await fixture();
    const target = await root();
    const championPath = join(target, 'docs/abilities/janna/champion.json');
    const imagePath = join(target, 'assets/images/champions/janna.png');
    await mkdir(join(target, 'docs/abilities/janna'), { recursive: true });
    await mkdir(join(target, 'assets/images/champions'), { recursive: true });
    await writeFile(championPath, 'existing champion record\n');
    await writeFile(imagePath, 'existing champion image');

    await importAbilities({ root: target, champions: ['Janna'], slots: ['Q'], client: client(data), now: () => '2026-08-13T00:00:00.000Z' });

    await expect(readFile(championPath, 'utf8')).resolves.toBe('existing champion record\n');
    await expect(readFile(imagePath, 'utf8')).resolves.toBe('existing champion image');
  });

  it('rejects a non-PC champion index before writing cache files', async () => {
    const target = await root();
    const wiki = {
      fetchChampionIndex: vi.fn(async () => ({
        source: 'return {}',
        revisionId: 1,
        timestamp: '2026-08-12T00:00:00Z',
        pageUrl: 'https://wiki.leagueoflegends.com/en-us/Module:ChampionDataWR/data',
      })),
    };

    await expect(syncChampionIndex({ root: target, client: wiki })).rejects.toThrow(/wild rift/i);
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('reports field-level hash changes during update', async () => {
    const data = await fixture();
    const target = await root();
    const logs: string[] = [];
    await importAbilities({ root: target, champions: ['Janna'], slots: ['Q'], client: client(data), now: () => '2026-08-13T00:00:00.000Z' });
    data.expanded.expandtemplates.wikitext = data.expanded.expandtemplates.wikitext.replace('1100 - 1760', '1100 - 1800');

    await importAbilities({ root: target, champions: ['Janna'], slots: ['Q'], update: true, client: client(data), now: () => '2026-08-14T00:00:00.000Z', log: line => logs.push(line) });

    expect(logs).toContain('Janna Q: fields.range changed');
  });

  it('updates independently changed champion and ability image bytes', async () => {
    const data = await fixture();
    const target = await root();
    await importAbilities({ root: target, champions: ['Janna'], slots: ['Q'], client: client(data), now: () => '2026-08-13T00:00:00.000Z' });
    const changedPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      update: true,
      client: client(data, { fetchBytes: vi.fn(async () => changedPng) }),
      now: () => '2026-08-14T00:00:00.000Z',
    });

    await expect(readFile(join(target, 'assets/images/spells/janna_q.png'))).resolves.toEqual(Buffer.from(changedPng));
    await expect(readFile(join(target, 'assets/images/champions/janna.png'))).resolves.toEqual(Buffer.from(changedPng));
    const manifest = JSON.parse(await readFile(join(target, 'assets/source-manifest.json'), 'utf8'));
    const expectedHash = createHash('sha256').update(changedPng).digest('hex');
    expect(manifest.sources.find((source: { localAssetKey: string }) => source.localAssetKey === 'spell_janna_q').contentHash).toBe(expectedHash);
    expect(manifest.sources.find((source: { localAssetKey: string }) => source.localAssetKey === 'champ_janna').contentHash).toBe(expectedHash);
  });

  it('retries transient MediaWiki failures with identifying headers and imageinfo originals', async () => {
    const responses = [new Response('busy', { status: 503 }), new Response(JSON.stringify({ query: { pages: [{ imageinfo: [{ url: 'https://example.test/original.png', sha1: 'a', mime: 'image/png' }] }] } }), { status: 200 })];
    const fetcher = vi.fn(async () => responses.shift()!);
    const wiki = createMediaWikiClient({ fetcher, sleep: async () => {}, throttleMs: 0 });

    await expect(wiki.fetchImageInfo('File:Howling Gale.png')).resolves.toMatchObject({ url: 'https://example.test/original.png' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('iiprop=url%7Csha1%7Cmime');
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/LOL2D/);
  });

  it('requests revision metadata and sentinel-expanded template fields from the API fixture', async () => {
    const data = await fixture();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(data.revision), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data.expanded), { status: 200 }));
    const wiki = createMediaWikiClient({ fetcher, sleep: async () => {}, throttleMs: 0 });

    await expect(wiki.fetchTemplate('Template:Data Janna/Howling Gale')).resolves.toMatchObject({
      revisionId: 456,
      fields: expect.stringContaining('@@description@@'),
      raw: { revision: data.revision, expanded: data.expanded },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get('action')).sort()).toEqual(['expandtemplates', 'query']);
  });

  it('accepts singular, plural, and all champion selection with sanitized slots', () => {
    expect(parseCli(['--champion', 'Janna'])).toMatchObject({ champions: ['Janna'] });
    expect(parseCli(['--champions', 'Janna,Lux', '--slots', 'Q,R'])).toMatchObject({ champions: ['Janna', 'Lux'], slots: ['Q', 'R'] });
    expect(parseCli(['--all'])).toMatchObject({ all: true });
    expect(() => parseCli(['--champion', '../Janna'])).toThrow(/invalid champion/i);
    expect(() => parseCli(['--champions', 'Janna,Janna'])).toThrow(/duplicate champion/i);
    expect(() => parseCli(['--champion', 'Janna', '--slots', 'Q,Q'])).toThrow(/duplicate slot/i);
  });
});
