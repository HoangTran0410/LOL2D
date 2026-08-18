import { describe, expect, it } from 'vitest';
import type { ChampionLoadout } from '../../src/game/config/PregameConfig';
import { DEFAULT_CHAMPION_LOADOUT } from '../../src/game/config/PregameConfig';

export const isLoadoutChanged = (draft: ChampionLoadout, initial: ChampionLoadout): boolean => {
  if (draft.mode !== initial.mode) return true;
  if (draft.mode === 'champion') {
    return (
      draft.championName !== initial.championName ||
      draft.summonerD !== initial.summonerD ||
      draft.summonerF !== initial.summonerF
    );
  }
  if (draft.customSlots.length !== initial.customSlots.length) return true;
  return draft.customSlots.some((slot, i) => slot !== initial.customSlots[i]);
};

describe('Loadout change detection', () => {
  const baseChampionLoadout: ChampionLoadout = {
    ...DEFAULT_CHAMPION_LOADOUT,
    championName: 'Ahri',
    summonerD: 'Flash',
    summonerF: 'Heal',
  };

  it('returns false when loadout is identical in champion mode', () => {
    const draft: ChampionLoadout = { ...baseChampionLoadout };
    expect(isLoadoutChanged(draft, baseChampionLoadout)).toBe(false);
  });

  it('returns true when champion changes', () => {
    const draft: ChampionLoadout = { ...baseChampionLoadout, championName: 'Zed' };
    expect(isLoadoutChanged(draft, baseChampionLoadout)).toBe(true);
  });

  it('returns true when summoner D changes', () => {
    const draft: ChampionLoadout = { ...baseChampionLoadout, summonerD: 'Ghost' };
    expect(isLoadoutChanged(draft, baseChampionLoadout)).toBe(true);
  });

  it('returns true when summoner F changes', () => {
    const draft: ChampionLoadout = { ...baseChampionLoadout, summonerF: 'Barrier' };
    expect(isLoadoutChanged(draft, baseChampionLoadout)).toBe(true);
  });

  it('returns true when switching mode from champion to custom', () => {
    const draft: ChampionLoadout = {
      ...baseChampionLoadout,
      mode: 'custom',
      customSlots: ['BasicAttack', 'Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R', 'Flash', 'Heal'],
    };
    expect(isLoadoutChanged(draft, baseChampionLoadout)).toBe(true);
  });

  it('returns false when custom slots are identical', () => {
    const customLoadout: ChampionLoadout = {
      mode: 'custom',
      championName: 'Ahri',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: ['BasicAttack', 'Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R', 'Flash', 'Heal'],
    };
    const draft: ChampionLoadout = {
      ...customLoadout,
      customSlots: [...customLoadout.customSlots],
    };
    expect(isLoadoutChanged(draft, customLoadout)).toBe(false);
  });

  it('returns true when any custom slot is modified', () => {
    const customLoadout: ChampionLoadout = {
      mode: 'custom',
      championName: 'Ahri',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: ['BasicAttack', 'Ahri_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R', 'Flash', 'Heal'],
    };
    const draft: ChampionLoadout = {
      ...customLoadout,
      customSlots: ['BasicAttack', 'Zed_Q', 'Ahri_W', 'Ahri_E', 'Ahri_R', 'Flash', 'Heal'],
    };
    expect(isLoadoutChanged(draft, customLoadout)).toBe(true);
  });
});
