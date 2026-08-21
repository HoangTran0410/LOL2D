import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetKeyForPath,
  buildManifestEntries,
  CORE_ASSET_TREE,
  PACK_ASSET_TREES,
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
   * `buildManifestEntries`/`renderManifest` gained a second, tree-shaped
   * caller (`packs/riot`, for now empty) beside core's. These two check the
   * plumbing that makes a second tree's keys and imports distinguishable
   * from core's without touching what core itself renders — the byte-
   * identical proof for the default argument lives in the tests below,
   * against the real checked-in files.
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

    /**
     * `packs/riot/assets/` is real — batch 4 task 4 moved 377 champion
     * portraits, spell icons and monster art files into it (378 minus
     * `basic_attack.png`, which stays core's: `coreSpells/BasicAttack.ts`
     * imports `AssetManager` directly and is typed against core's own
     * `AssetKey` union, permanently — see `coreSpellsApiSurface.test.ts`).
     * Generating against this tree now produces the real, populated
     * manifest — still without ever reading core's own `assets/`.
     */
    it('generates the real manifest for packs/riot/assets, never reading core/assets', async () => {
      const source = await renderAssetManifestSource(root, { tree: PACK_ASSET_TREES.riot });

      expect(source).toContain('export const assetManifest = {');
      expect(source).toContain('champ_janna');
      expect(source).toContain('spell_janna_q');
      // Core-only art (never moved) must not leak into the pack's own tree.
      expect(source).not.toContain('buff_stun');
      expect(source).not.toContain('spell_basic_attack');
    });

    it("leaves core's own manifest byte-identical to what is already checked in", async () => {
      const generated = await renderAssetManifestSource(root);
      const committed = await readFile(resolve(root, CORE_ASSET_TREE.outputPath), 'utf8');

      expect(generated).toBe(committed);
    });
  });
});
