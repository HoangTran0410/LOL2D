import { describe, expect, it } from 'vitest';
import {
  assetKeyForPath,
  buildManifestEntries,
  renderManifest,
} from '../../scripts/generate-assets.mjs';

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
});
