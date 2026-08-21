import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetKeyForPath,
  buildManifestEntries,
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
   * `assets/json/summoner_map.json` is read directly, as raw text, by
   * `src/content/maps/summonersRiftGeometry.ts` (a `?raw` import — see that
   * module's own header for why not through `AssetManager`). Nothing has
   * read it through `AssetManager`/`assetManifest` since Task 5 moved the
   * map off `preset.ts`'s old synchronous asset lookup, but the generator
   * still walked `assets/` blind to that and kept minting a
   * `json_summoner_map` manifest entry — a second, separate `?url` import of
   * the same 22,180 bytes, which Vite then emits as its own
   * `dist/assets/summoner_map-*.json` and the service worker precaches on
   * top of the copy already inlined into `map-summonersrift-*.js`. A first
   * offline install downloaded the map twice.
   */
  it('does not mint a manifest entry for summoner_map.json — it only ever arrives via a ?raw import', async () => {
    const source = await renderAssetManifestSource(root);
    expect(source).not.toContain('json_summoner_map');
    expect(source).not.toContain('assets/json/summoner_map.json');
  });
});
