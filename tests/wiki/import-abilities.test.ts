import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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
      source:
        'return { Janna = { name = "Janna", image = "JannaSquare.png", skill_q = { "Howling Gale", "Howling Gale Recast" } } }',
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
    fetchImageInfo: vi.fn(async file =>
      file.includes('JannaSquare')
        ? {
            url: 'https://wiki.leagueoflegends.com/images/JannaSquare.png',
            sha1: 'fedcba9876543210',
            mime: 'image/png',
          }
        : data.imageinfo.query.pages[0].imageinfo[0]
    ),
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
    expect(request).toContain(
      '@@effectradius@@{{Template:Data Lux/Final Spark|pst2|effect radius}}'
    );
    expect(request).toContain('@@radius@@{{Template:Data Lux/Final Spark|pst2|radius}}');
    expect(
      normalizeAbilityFields(
        '@@name@@Final Spark@@icon@@Final Spark.png@@casttime@@1@@effectradius@@@@radius@@@@'
      )
    ).toEqual({
      name: 'Final Spark',
      icon: 'Final Spark.png',
      casttime: '1',
    });
  });

  it('omits exact unresolved pst2 placeholders without dropping embedded braces', () => {
    const fields = normalizeAbilityFields(
      '@@description@@Keep {{{value}}} literal@@description2@@ {{{description2}}} @@range@@{{{target range}}}@@'
    );

    expect(fields.description).toMatchObject({ raw: 'Keep {{{value}}} literal' });
    expect(fields).not.toHaveProperty('description2');
    expect(fields).not.toHaveProperty('range');
  });

  it('normalizes selected fields and preserves raw formulas', async () => {
    const data = await fixture();
    const fields = normalizeAbilityFields(data.expanded.expandtemplates.wikitext);

    expect(fields.description).toEqual({
      raw: "'''Active:''' Janna summons a [[File:Airborne icon.png|20px]] whirlwind dealing {{as|magic damage}}.",
      text: 'Active: Janna summons a whirlwind dealing magic damage.',
    });
    expect(fields.leveling).toMatchObject({
      raw: expect.stringContaining('60 / 85'),
      text: expect.stringContaining('60 / 85'),
    });
    expect(fields.range).toBe('1100 - 1760');
    expect(fields.projectile).toBe(true);
  });

  it('uses the authoritative secondary icon when the primary icon is false', async () => {
    const data = await fixture();
    const target = await root();
    data.expanded.expandtemplates.wikitext = data.expanded.expandtemplates.wikitext.replace(
      '@@icon@@Howling Gale.png',
      '@@icon@@false@@icon2@@Glacial Storm.png'
    );
    const wiki = client(data);

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: wiki,
      now: () => '2026-08-13T00:00:00.000Z',
    });

    expect(wiki.fetchImageInfo).toHaveBeenCalledWith('Glacial Storm.png');
    const record = JSON.parse(await readFile(join(target, 'docs/abilities/janna/q.json'), 'utf8'));
    expect(record.forms[0].fields).toMatchObject({ icon: 'false', icon2: 'Glacial Storm.png' });
  });

  it('downloads a distinct icon per ability form instead of just the first', async () => {
    const target = await root();
    // Modeled on the real Fizz E data: each form is its own `Template:Data
    // Fizz/<Form>` page with its own `name`/`icon` fields, and `icon2` is an
    // unresolved `{{{icon2}}}` placeholder on both (dropped by normalization).
    const wiki = {
      fetchChampionIndex: vi.fn(async () => ({
        source:
          'return { Fizz = { name = "Fizz", image = "FizzSquare.png", skill_e = { "Playful", "Trickster" } } }',
        revisionId: 200,
        timestamp: '2026-08-12T00:00:00Z',
        pageUrl: 'https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data',
      })),
      fetchTemplate: vi.fn(async (page: string) => {
        const isPlayful = page.endsWith('/Playful');
        return {
          page,
          revisionId: isPlayful ? 4008451 : 4007741,
          timestamp: isPlayful ? '2026-04-14T19:15:38Z' : '2026-04-12T13:45:59Z',
          fields: isPlayful
            ? '@@name@@Playful@@icon@@Playful.png@@icon2@@{{{icon2}}}@@description@@Dash to safety.@@'
            : '@@name@@Trickster@@icon@@Trickster.png@@icon2@@{{{icon2}}}@@description@@Dash and splash early.@@',
          raw: { revision: {}, expanded: {} },
          pageUrl: `https://wiki.leagueoflegends.com/en-us/${page.replaceAll(' ', '_')}`,
        };
      }),
      fetchImageInfo: vi.fn(async (file: string) => {
        if (file.includes('FizzSquare'))
          return {
            url: 'https://wiki.leagueoflegends.com/images/FizzSquare.png',
            sha1: 'champsha1',
            mime: 'image/png',
          };
        if (file === 'Playful.png')
          return {
            url: 'https://wiki.leagueoflegends.com/images/Fizz_Playful.png',
            sha1: 'playfulsha1',
            mime: 'image/png',
          };
        if (file === 'Trickster.png')
          return {
            url: 'https://wiki.leagueoflegends.com/images/Fizz_Trickster.png',
            sha1: 'tricksha1',
            mime: 'image/png',
          };
        throw new Error(`unexpected file request: ${file}`);
      }),
      fetchBytes: vi.fn(async (url: string) => {
        if (url.includes('Playful')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
        if (url.includes('Trickster')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 2]);
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      }),
    };

    await importAbilities({
      root: target,
      champions: ['Fizz'],
      slots: ['E'],
      client: wiki,
      now: () => '2026-08-13T00:00:00.000Z',
    });

    expect(wiki.fetchImageInfo).toHaveBeenCalledWith('Playful.png');
    expect(wiki.fetchImageInfo).toHaveBeenCalledWith('Trickster.png');

    const record = JSON.parse(await readFile(join(target, 'docs/abilities/fizz/e.json'), 'utf8'));
    expect(record.forms).toHaveLength(2);
    expect(record.forms[0]).toMatchObject({
      name: 'Playful',
      asset: {
        key: 'spell_fizz_e',
        originalUrl: 'https://wiki.leagueoflegends.com/images/Fizz_Playful.png',
      },
    });
    expect(record.forms[1]).toMatchObject({
      name: 'Trickster',
      asset: {
        key: 'spell_fizz_e2',
        originalUrl: 'https://wiki.leagueoflegends.com/images/Fizz_Trickster.png',
      },
    });
    expect(record.asset).toMatchObject({ key: 'spell_fizz_e' });

    await expect(
      readFile(join(target, 'packs/riot/assets/images/spells/fizz_e.png'))
    ).resolves.toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    await expect(
      readFile(join(target, 'packs/riot/assets/images/spells/fizz_e2.png'))
    ).resolves.toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]));

    const manifest = JSON.parse(
      await readFile(join(target, 'assets/source-manifest.json'), 'utf8')
    );
    expect(
      manifest.sources.find(
        (source: { localAssetKey: string }) => source.localAssetKey === 'spell_fizz_e'
      )
    ).toMatchObject({
      localPath: 'packs/riot/assets/images/spells/fizz_e.png',
      sourceUrl: 'https://wiki.leagueoflegends.com/images/Fizz_Playful.png',
    });
    expect(
      manifest.sources.find(
        (source: { localAssetKey: string }) => source.localAssetKey === 'spell_fizz_e2'
      )
    ).toMatchObject({
      localPath: 'packs/riot/assets/images/spells/fizz_e2.png',
      sourceUrl: 'https://wiki.leagueoflegends.com/images/Fizz_Trickster.png',
    });

    await expect(checkAbilities(target)).resolves.toEqual({ records: 3, forms: 2, skippedByPack: new Map() });
  });

  it('writes deterministic raw and normalized caches with source metadata', async () => {
    const data = await fixture();
    const target = await root();

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });

    const record = JSON.parse(await readFile(join(target, 'docs/abilities/janna/q.json'), 'utf8'));
    const raw = JSON.parse(
      await readFile(join(target, 'docs/abilities/cache/raw/janna/q.json'), 'utf8')
    );
    const champion = JSON.parse(
      await readFile(join(target, 'docs/abilities/janna/champion.json'), 'utf8')
    );
    const manifest = JSON.parse(
      await readFile(join(target, 'assets/source-manifest.json'), 'utf8')
    );
    expect(record).toMatchObject({
      schemaVersion: 1,
      champion: 'Janna',
      slot: 'Q',
      forms: [
        { name: 'Howling Gale', fields: { range: '1100 - 1760' } },
        { name: 'Howling Gale Recast', fields: { range: '1100 - 1760' } },
      ],
      source: {
        revisionId: 456,
        fetchedAt: '2026-08-13T00:00:00.000Z',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      asset: {
        key: 'spell_janna_q',
        originalUrl: 'https://wiki.leagueoflegends.com/images/Howling_Gale.png',
      },
    });
    expect(raw).toMatchObject({
      schemaVersion: 1,
      source: { revisionId: 456 },
      payload: [
        {
          page: 'Template:Data Janna/Howling Gale',
          response: { revision: data.revision, expanded: data.expanded },
        },
        {
          page: 'Template:Data Janna/Howling Gale',
          response: { revision: data.revision, expanded: data.expanded },
        },
      ],
    });
    expect(champion).toMatchObject({
      schemaVersion: 1,
      champion: 'Janna',
      asset: { key: 'champ_janna' },
    });
    expect(
      await readFile(join(target, 'packs/riot/assets/images/spells/janna_q.png'))
    ).toHaveLength(8);
    expect(
      await readFile(join(target, 'packs/riot/assets/images/champions/janna.png'))
    ).toHaveLength(8);
    expect(
      manifest.sources.find(
        (source: { localAssetKey: string }) => source.localAssetKey === 'spell_janna_q'
      ).contentHash
    ).toBe(
      createHash('sha256')
        .update(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
        .digest('hex')
    );

    await expect(checkAbilities(target)).resolves.toEqual({ records: 3, forms: 2, skippedByPack: new Map() });
    raw.source.fetchedAt = 'invalid';
    await writeFile(join(target, 'docs/abilities/cache/raw/janna/q.json'), JSON.stringify(raw));
    await expect(checkAbilities(target)).rejects.toThrow(/source timestamp/i);
  });

  it('writes nothing when any fetch or validation step fails', async () => {
    const data = await fixture();
    const target = await root();
    await writeFile(join(target, 'existing.txt'), 'keep me');
    const failing = client(data, {
      fetchBytes: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    await expect(
      importAbilities({
        root: target,
        champions: ['Janna'],
        slots: ['Q'],
        client: failing,
        now: () => '2026-08-13T00:00:00.000Z',
      })
    ).rejects.toThrow(/offline/);
    await expect(readdir(target)).resolves.toEqual(['existing.txt']);
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('keep me');
  });

  it('does not overwrite an existing champion record when importing another slot', async () => {
    const data = await fixture();
    const target = await root();
    const championPath = join(target, 'docs/abilities/janna/champion.json');
    const imagePath = join(target, 'packs/riot/assets/images/champions/janna.png');
    await mkdir(join(target, 'docs/abilities/janna'), { recursive: true });
    await mkdir(join(target, 'packs/riot/assets/images/champions'), { recursive: true });
    await writeFile(championPath, 'existing champion record\n');
    await writeFile(imagePath, 'existing champion image');

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });

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
    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });
    data.expanded.expandtemplates.wikitext = data.expanded.expandtemplates.wikitext.replace(
      '1100 - 1760',
      '1100 - 1800'
    );

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      update: true,
      client: client(data),
      now: () => '2026-08-14T00:00:00.000Z',
      log: line => logs.push(line),
    });

    expect(logs).toContain('Janna Q: fields.range changed');
  });

  it('updates independently changed champion and ability image bytes', async () => {
    const data = await fixture();
    const target = await root();
    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });
    const changedPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      update: true,
      client: client(data, { fetchBytes: vi.fn(async () => changedPng) }),
      now: () => '2026-08-14T00:00:00.000Z',
    });

    await expect(
      readFile(join(target, 'packs/riot/assets/images/spells/janna_q.png'))
    ).resolves.toEqual(Buffer.from(changedPng));
    await expect(
      readFile(join(target, 'packs/riot/assets/images/champions/janna.png'))
    ).resolves.toEqual(Buffer.from(changedPng));
    const manifest = JSON.parse(
      await readFile(join(target, 'assets/source-manifest.json'), 'utf8')
    );
    const expectedHash = createHash('sha256').update(changedPng).digest('hex');
    expect(
      manifest.sources.find(
        (source: { localAssetKey: string }) => source.localAssetKey === 'spell_janna_q'
      ).contentHash
    ).toBe(expectedHash);
    expect(
      manifest.sources.find(
        (source: { localAssetKey: string }) => source.localAssetKey === 'champ_janna'
      ).contentHash
    ).toBe(expectedHash);
  });

  it('replaces an old image extension and generated manifest in one import', async () => {
    const data = await fixture();
    const target = await root();
    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const wiki = client(data, {
      fetchImageInfo: vi.fn(async (file: string) =>
        file.includes('JannaSquare')
          ? {
              url: 'https://wiki.leagueoflegends.com/images/JannaSquare.png',
              sha1: 'fedcba9876543210',
              mime: 'image/png',
            }
          : {
              url: 'https://wiki.leagueoflegends.com/images/Howling_Gale.jpg',
              sha1: 'changed',
              mime: 'image/jpeg',
            }
      ),
      fetchBytes: vi.fn(async (url: string) =>
        url.endsWith('.jpg') ? jpeg : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      ),
    });

    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      update: true,
      client: wiki,
      now: () => '2026-08-14T00:00:00.000Z',
    });

    await expect(
      stat(join(target, 'packs/riot/assets/images/spells/janna_q.png'))
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      readFile(join(target, 'packs/riot/assets/images/spells/janna_q.jpg'))
    ).resolves.toEqual(Buffer.from(jpeg));
    // The spell's own icon lives in `packs/riot/assets/`, not core's tree — the
    // manifest that changes with it is `packs/riot/generated/assetManifest.ts`,
    // generated by the pack's own `packs/riot/scripts/generate-assets.mjs` and
    // rooted at the pack's own directory, so its imports read `../assets/...`
    // rather than a round-trip through the repo root.
    const generated = await readFile(join(target, 'packs/riot/generated/assetManifest.ts'), 'utf8');
    expect(generated).toContain('../assets/images/spells/janna_q.jpg?url');
    expect(generated).not.toContain('../assets/images/spells/janna_q.png?url');
    await expect(checkAbilities(target)).resolves.toEqual({ records: 3, forms: 2, skippedByPack: new Map() });
  });

  it('writes nothing when hypothetical asset manifest generation fails', async () => {
    const data = await fixture();
    const target = await root();
    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });
    const tracked = [
      'docs/abilities/janna/q.json',
      'packs/riot/assets/images/spells/janna_q.png',
      'assets/source-manifest.json',
      'src/generated/assetManifest.ts',
      'packs/riot/generated/assetManifest.ts',
    ];
    const before = await Promise.all(tracked.map(path => readFile(join(target, path))));
    await writeFile(
      join(target, 'packs/riot/assets/images/spells/janna-q.webp'),
      new Uint8Array([82, 73, 70, 70])
    );
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const wiki = client(data, {
      fetchImageInfo: vi.fn(async (file: string) =>
        file.includes('JannaSquare')
          ? {
              url: 'https://wiki.leagueoflegends.com/images/JannaSquare.png',
              sha1: 'champion',
              mime: 'image/png',
            }
          : {
              url: 'https://wiki.leagueoflegends.com/images/Howling_Gale.jpg',
              sha1: 'ability',
              mime: 'image/jpeg',
            }
      ),
      fetchBytes: vi.fn(async (url: string) =>
        url.endsWith('.jpg') ? jpeg : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      ),
    });

    await expect(
      importAbilities({
        root: target,
        champions: ['Janna'],
        slots: ['Q'],
        update: true,
        client: wiki,
        now: () => '2026-08-14T00:00:00.000Z',
      })
    ).rejects.toThrow(/duplicate asset key/i);

    for (const [index, path] of tracked.entries()) {
      await expect(readFile(join(target, path))).resolves.toEqual(before[index]);
    }
    await expect(
      stat(join(target, 'packs/riot/assets/images/spells/janna_q.jpg'))
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('detects normalized record, local image, and source-manifest corruption', async () => {
    const data = await fixture();
    const target = await root();
    await importAbilities({
      root: target,
      champions: ['Janna'],
      slots: ['Q'],
      client: client(data),
      now: () => '2026-08-13T00:00:00.000Z',
    });
    const recordPath = join(target, 'docs/abilities/janna/q.json');
    const imagePath = join(target, 'packs/riot/assets/images/spells/janna_q.png');
    const manifestPath = join(target, 'assets/source-manifest.json');
    const originalRecord = await readFile(recordPath);
    const originalImage = await readFile(imagePath);
    const originalManifest = await readFile(manifestPath);

    const record = JSON.parse(originalRecord.toString());
    record.forms[0].fields.range = 'corrupted';
    await writeFile(recordPath, JSON.stringify(record));
    await expect(checkAbilities(target)).rejects.toThrow(/content hash/i);
    await writeFile(recordPath, originalRecord);

    await writeFile(imagePath, new Uint8Array([...originalImage, 1]));
    await expect(checkAbilities(target)).rejects.toThrow(/image hash/i);
    await writeFile(imagePath, originalImage);

    const manifest = JSON.parse(originalManifest.toString());
    manifest.sources.find(
      (source: { localAssetKey: string }) => source.localAssetKey === 'spell_janna_q'
    ).localPath = 'packs/riot/assets/images/spells/wrong.png';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(checkAbilities(target)).rejects.toThrow(/asset key\/path/i);
    await writeFile(manifestPath, originalManifest);

    const generatedPath = join(target, 'src/generated/assetManifest.ts');
    await writeFile(generatedPath, `${await readFile(generatedPath, 'utf8')}\n// stale\n`);
    await expect(checkAbilities(target)).rejects.toThrow(/generated asset manifest is stale/i);
  });

  it('retries transient MediaWiki failures with identifying headers and imageinfo originals', async () => {
    const responses = [
      new Response('busy', { status: 503 }),
      new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                imageinfo: [
                  { url: 'https://example.test/original.png', sha1: 'a', mime: 'image/png' },
                ],
              },
            ],
          },
        }),
        { status: 200 }
      ),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    const wiki = createMediaWikiClient({ fetcher, sleep: async () => {}, throttleMs: 0 });

    await expect(wiki.fetchImageInfo('File:Howling Gale.png')).resolves.toMatchObject({
      url: 'https://example.test/original.png',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('iiprop=url%7Csha1%7Cmime');
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/LOL2D/);
  });

  it('requests revision metadata and sentinel-expanded template fields from the API fixture', async () => {
    const data = await fixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(data.revision), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data.expanded), { status: 200 }));
    const wiki = createMediaWikiClient({ fetcher, sleep: async () => {}, throttleMs: 0 });

    await expect(wiki.fetchTemplate('Template:Data Janna/Howling Gale')).resolves.toMatchObject({
      revisionId: 456,
      fields: expect.stringContaining('@@description@@'),
      raw: { revision: data.revision, expanded: data.expanded },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get('action')).sort()
    ).toEqual(['expandtemplates', 'query']);
  });

  it('accepts singular, plural, and all champion selection with sanitized slots', () => {
    expect(parseCli(['--champion', 'Janna'])).toMatchObject({ champions: ['Janna'] });
    expect(parseCli(['--champions', 'Janna,Lux', '--slots', 'Q,R'])).toMatchObject({
      champions: ['Janna', 'Lux'],
      slots: ['Q', 'R'],
    });
    expect(parseCli(['--all'])).toMatchObject({ all: true });
    expect(() => parseCli(['--champion', '../Janna'])).toThrow(/invalid champion/i);
    expect(() => parseCli(['--champions', 'Janna,Janna'])).toThrow(/duplicate champion/i);
    expect(() => parseCli(['--champion', 'Janna', '--slots', 'Q,Q'])).toThrow(/duplicate slot/i);
  });
});
