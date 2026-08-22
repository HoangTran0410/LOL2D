import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetKeyForPath,
  buildManifestEntries,
  CORE_ASSET_TREE,
  generate,
  renderAssetManifestSource,
  renderManifest,
} from '../../scripts/generate-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('asset manifest generator', () => {
  it.each([
    ['assets/images/champions/janna.png', 'champ_janna'],
    ['assets/images/spells/janna_q.png', 'spell_janna_q'],
    ['assets/images/buffs/stun.png', 'buff_stun'],
    ['assets/images/monsters/Blue_Sentinel.png', 'monster_Blue_Sentinel'],
    ['assets/json/summoner_map.json', 'json_summoner_map'],
    ['assets/images/others/menu-bg.webp', 'other_menu_bg'],
  ])('maps %s to stable key %s', (path, key) => {
    expect(assetKeyForPath(path)).toBe(key);
  });

  it('rejects duplicate generated keys', () => {
    expect(() =>
      buildManifestEntries(['assets/images/others/menu-bg.png', 'assets/images/others/menu_bg.jpg'])
    ).toThrow(/duplicate asset key "other_menu_bg"/i);
  });

  it('generates static ?url imports for every supported file', () => {
    const entries = buildManifestEntries([
      'assets/images/champions/janna.png',
      'assets/json/summoner_map.json',
      'assets/sounds/janna_q.ogg',
      'assets/cursors/normal.cur',
    ]);

    const source = renderManifest(entries);

    expect(source.match(/\?url';/g)).toHaveLength(entries.length);
    expect(source).toContain("kind: 'image'");
    expect(source).toContain("kind: 'json'");
    expect(source).toContain("kind: 'audio'");
    expect(source).toContain("kind: 'url'");
  });

  it('rejects unsupported asset files', () => {
    expect(() => buildManifestEntries(['assets/images/readme.txt'])).toThrow(
      /unsupported asset file/i
    );
  });

  /**
   * `buildManifestEntries`/`renderManifest` still support a second, tree-
   * shaped caller's key prefix and import depth — `packs/riot/scripts/
   * generate-assets.mjs` is exactly that caller now, with its own copy of
   * this same logic (content-pack-extraction batch 5 task 5; the survey
   * behind it, `docs/superpowers/surveys/2026-08-22-pack-package-
   * boundary.md` §4, measured this walk as having zero core dependency, so
   * the pack duplicates it rather than importing it). What used to be
   * `PACK_ASSET_TREES.riot`'s own byte-identical proof and stale-manifest
   * test now live beside that copy, in `tests/packs/riot/generate-
   * assets.test.ts` — these two just check the generic plumbing.
   */
  describe('a second tree', () => {
    it('prefixes generated keys so two trees cannot collide on the same relative path', () => {
      const bare = buildManifestEntries(['assets/images/champions/janna.png']);
      const prefixed = buildManifestEntries(['assets/images/champions/janna.png'], {
        keyPrefix: 'riot_',
      });

      expect(bare[0].key).toBe('champ_janna');
      expect(prefixed[0].key).toBe('riot_champ_janna');
    });

    it('walks back further to the repository root for a deeper output file', () => {
      const entries = buildManifestEntries(['assets/images/champions/janna.png']);
      const coreDepth = renderManifest(entries);
      const deeper = renderManifest(entries, { importPrefix: '../../../' });

      expect(coreDepth).toContain("from '../../assets/images/champions/janna.png?url'");
      expect(deeper).toContain("from '../../../assets/images/champions/janna.png?url'");
    });

    it("leaves core's own manifest byte-identical to what is already checked in", async () => {
      const generated = await renderAssetManifestSource(root);
      const committed = await readFile(resolve(root, CORE_ASSET_TREE.outputPath), 'utf8');

      expect(generated).toBe(committed);
    });

    it('names the regenerate command in the stale-manifest message', async () => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'lol2d-assets-stale-'));
      try {
        await mkdir(join(tmpRoot, 'assets'), { recursive: true });
        await expect(generate(tmpRoot, true, CORE_ASSET_TREE)).rejects.toThrow(
          /Run npm run assets:generate\./
        );
      } finally {
        await rm(tmpRoot, { recursive: true, force: true });
      }
    });
  });
});
