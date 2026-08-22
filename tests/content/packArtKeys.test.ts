import { describe, expect, it } from 'vitest';
import AssetManager from '../../src/managers/AssetManager';
import { installedPacks } from '../../src/generated/installedPacks';
import { data as referenceData } from '../../packs/reference/pack';
import type { ContentPackData } from '../../src/content/ContentPack';

/**
 * Every art key a pack's data declares has to resolve to something.
 *
 * `AssetManager.get` **throws** on a key nothing declares — it does not fall
 * back to a placeholder square; `placeholderStyle` is for an asset that is
 * declared and not yet loaded. So a typo, or a manifest that was never
 * regenerated after art moved, is not a missing picture. It is a champion,
 * monster or minion whose *constructor* throws, in the middle of a match.
 *
 * This exists because content-pack-extraction batch 5 task 8's departure drill
 * found exactly that, in the pack that is supposed to prove core is a complete
 * game standing alone: `packs/reference/pack.ts` declares its one neutral camp
 * with `avatar: 'reference_monster_warden'`, and there was no such key —
 * `assets/images/reference/` held Vera's portrait and her four spell icons and
 * nothing else. Nobody had noticed because a default match boots Summoner's
 * Rift, which has no warden; with the riot pack moved out of the tree the
 * default map becomes Proving Grounds, whose one neutral slot is that camp,
 * and `world.jungle` is `true` in `DEFAULT_PREGAME_CONFIG`. The first thing a
 * player would have seen of "core, alone" was a thrown `Unknown asset key`.
 *
 * Scanning the *data* halves rather than a running match is what makes this
 * cheap enough to be a unit test: `ContentPackData` is plain values, and every
 * key a unit will ever ask for is written down in it.
 */
const packs: { name: string; data: ContentPackData }[] = [
  ...installedPacks.map(pack => ({ name: pack.name, data: pack.data })),
  { name: 'reference', data: referenceData },
];

/** Every art key `data` declares, with a label saying where each came from. */
function artKeys(data: ContentPackData): { key: string; where: string }[] {
  const out: { key: string; where: string }[] = [];
  for (const champion of data.champions ?? []) {
    if (champion.image) out.push({ key: champion.image, where: `champion ${champion.id}` });
  }
  for (const [id, display] of Object.entries(data.spellDisplay ?? {})) {
    if (display.iconKey) out.push({ key: display.iconKey, where: `spell ${id}` });
  }
  for (const [id, monster] of Object.entries(data.monsters ?? {})) {
    for (const member of monster.members ?? []) {
      if (member.avatar) out.push({ key: member.avatar, where: `monster ${id}/${member.name}` });
    }
  }
  return out;
}

describe('every art key an installed pack declares resolves', () => {
  it('finds packs to scan, or this proves nothing', () => {
    // The reference pack is always installed, so this floor holds in a
    // pack-free checkout too.
    expect(packs.length).toBeGreaterThan(0);
  });

  for (const { name, data } of packs) {
    it(`${name}`, () => {
      const keys = artKeys(data);
      // A pack that declared no art at all would pass every assertion below
      // for the wrong reason.
      expect(keys.length).toBeGreaterThan(0);
      const unresolvable = keys
        .filter(({ key }) => {
          try {
            AssetManager.get(key as never);
            return false;
          } catch {
            return true;
          }
        })
        .map(({ key, where }) => `${where}: ${key}`);
      expect(unresolvable).toEqual([]);
    });
  }
});
