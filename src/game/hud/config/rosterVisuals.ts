/**
 * What a roster row looks like when there is no unit to look at.
 *
 * In a match a row draws itself from the champion standing on the map — its
 * portrait, its four live spells. On the menu there is no match, so the same
 * row has to be derived from the *loadout*, which is a different question with
 * a different answer: a bot left on `'random'` is "Ngẫu Nhiên" here and some
 * particular champion there, and the two must not be confused (see
 * `ConfigRosterEntry.title`).
 *
 * A plain module rather than logic inside the tab, for the reason at the bottom
 * of CLAUDE.md's Code Style: `<script setup>` *is* the setup function and reruns
 * on every mount, and none of this wants to be re-derived by Vue or tested
 * through a mount.
 */
import { packAsset } from '@/game/config/spellCatalog';
import type { ChampionLoadout } from '@/game/config/PregameConfig';
import { getPregameCatalog } from '@/scenes/setup/pregameCatalog';
/**
 * The catalogue id stays *inside* this module and its callers: the public
 * `RosterAbility` carries only `describable`, because the in-game source has no
 * catalogue id to put there. See `MatchConfigSource.describeAbility`.
 */
export interface LoadoutAbility {
  letter: string;
  url: string | null;
  spellId: string | null;
}

/** Q/W/E/R, and their positions in `customSlots` — which is `[A, Q, W, E, R, D, F]`. */
export const ABILITY_LETTERS = ['Q', 'W', 'E', 'R'] as const;
const CUSTOM_ABILITY_SLOTS = [1, 2, 3, 4];

export interface LoadoutVisual {
  title: string;
  avatarUrl: string | null;
  abilities: LoadoutAbility[];
}

const emptyAbilities = (): LoadoutAbility[] =>
  ABILITY_LETTERS.map(letter => ({ letter, url: null, spellId: null }));

/**
 * No stable portrait for a random champion or a custom kit: both resolve a
 * fresh one per spawn (see `preset.ts`), so a picture here would be a promise
 * the match does not keep.
 */
export const visualOfLoadout = (loadout: ChampionLoadout): LoadoutVisual => {
  const { champions, catalogById } = getPregameCatalog();

  if (loadout.mode === 'custom') {
    return {
      title: 'Tự Ghép Chiêu',
      avatarUrl: null,
      abilities: CUSTOM_ABILITY_SLOTS.map((slot, i) => {
        const choice = loadout.customSlots[slot];
        const entry = choice && choice !== 'random' ? catalogById.get(choice) : undefined;
        return {
          letter: ABILITY_LETTERS[i],
          url: entry?.display.iconUrl ?? null,
          spellId: entry ? entry.id : null,
        };
      }),
    };
  }

  if (loadout.championName === 'random') {
    return { title: 'Ngẫu Nhiên', avatarUrl: null, abilities: emptyAbilities() };
  }

  const champion = champions.find(entry => entry.name === loadout.championName);
  if (!champion) {
    // A stored name this build no longer has. `preset.ts` falls back to a
    // random champion at resolution time, so the row says the same thing the
    // match will do rather than showing a name that resolves to nothing.
    return { title: 'Ngẫu Nhiên', avatarUrl: null, abilities: emptyAbilities() };
  }

  return {
    title: champion.name,
    avatarUrl: packAsset(champion.avatar).url,
    abilities: ABILITY_LETTERS.map((letter, i) => {
      const spell = champion.spells[i];
      return {
        letter,
        url: spell?.display.iconUrl ?? null,
        spellId: spell ? spell.id : null,
      };
    }),
  };
};
