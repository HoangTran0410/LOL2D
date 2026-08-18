/**
 * The pregame free-form kit builder's data source: `listSpellCatalog`,
 * `getSpellDisplay`, and the `mode: 'custom'` branch of
 * `getChampionPresetFromLoadout`. Also the catalogue-completeness audit the
 * owner asked for in plain, re-runnable form: every export in the
 * `AllSpells` barrel must appear in `SpellGroups` (nothing silently
 * unreachable) and in `listSpellCatalog` (nothing silently missing from the
 * free-form picker).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn(() => ({ url: 'x' })),
    getAsset: vi.fn(() => undefined),
    placeholder: vi.fn(() => ({ url: 'x' })),
  },
}));

import * as AllSpells from '../../src/game/gameObject/spells/index';
import {
  spellGroups,
  getChampionPresetFromLoadout,
  listSpellCatalog,
  getSpellDisplay,
  spellClassOfId,
} from '../../src/game/preset';
import { SLOT_COUNT, type ChampionLoadout } from '../../src/game/config/PregameConfig';
import { loadEverySpellForTests } from '../game/spell/registry';

// Spell classes arrive by dynamic import in the game (`spellRegistry.ts`);
// this fills the registry synchronously so a test can read the whole
// catalogue without awaiting 238 of them.
beforeAll(loadEverySpellForTests);

const barrelKeys = Object.keys(AllSpells);

describe('listSpellCatalog — catalogue completeness', () => {
  it('has exactly one entry per export in the AllSpells barrel', () => {
    const catalog = listSpellCatalog();
    expect(catalog).toHaveLength(barrelKeys.length);
    expect(new Set(catalog.map(e => e.id))).toEqual(new Set(barrelKeys));
  });

  it('every catalogue id resolves back to the exact class AllSpells exports under it', () => {
    // The catalogue is generated data now; this is the join back to the code,
    // and the one assertion that would catch the generated file and the barrel
    // having drifted apart.
    for (const entry of listSpellCatalog()) {
      expect(spellClassOfId(entry.id)).toBe((AllSpells as Record<string, unknown>)[entry.id]);
    }
  });

  it('every spell in AllSpells appears in SpellGroups (nothing silently unreachable from the champion/summoner shelves)', () => {
    const referenced = new Set<unknown>();
    for (const group of spellGroups()) {
      for (const spellClass of group.spells) referenced.add(spellClass);
    }
    const missing = barrelKeys.filter(
      key => !referenced.has((AllSpells as Record<string, unknown>)[key])
    );
    expect(missing).toEqual([]);
  });

  it('gives every catalogue entry a non-null groupName, since every spell is in some SpellGroups shelf', () => {
    const withoutGroup = listSpellCatalog().filter(e => e.groupName === null);
    expect(withoutGroup.map(e => e.id)).toEqual([]);
  });

  it('constructs a real, non-empty description for every spell — the null-owner audit, pinned as a regression test', () => {
    const broken = listSpellCatalog().filter(
      e =>
        e.display.name === '?' ||
        typeof e.display.description !== 'string' ||
        e.display.description.length === 0
    );
    expect(broken.map(e => e.id)).toEqual([]);
  });
});

describe('getSpellDisplay — match-rules-aware numbers', () => {
  it('reports the raw and effective cooldown/mana as equal with no match rules', () => {
    const display = getSpellDisplay(AllSpells.Lux_R);
    expect(display.effectiveCoolDownMs).toBe(display.coolDownMs);
    expect(display.effectiveManaCost).toBe(display.manaCost);
  });

  it('halves the effective cooldown at 50% reduction, leaving the raw number untouched', () => {
    const display = getSpellDisplay(AllSpells.Lux_R, { cooldownMultiplier: 0.5, manaFree: false });
    expect(display.coolDownMs).toBe(10_000);
    expect(display.effectiveCoolDownMs).toBe(5_000);
  });

  it('zeroes the effective mana cost under URF, leaving the raw number untouched', () => {
    const display = getSpellDisplay(AllSpells.Lux_R, { cooldownMultiplier: 1, manaFree: true });
    expect(display.manaCost).toBe(100);
    expect(display.effectiveManaCost).toBe(0);
  });

  it('carries the Vietnamese HTML description through untouched', () => {
    const display = getSpellDisplay(AllSpells.Ahri_Q);
    expect(display.description).toContain('<span');
    expect(display.description.length).toBeGreaterThan(10);
  });
});

describe('getChampionPresetFromLoadout — mode: "custom"', () => {
  const customLoadout = (customSlots: string[]): ChampionLoadout => ({
    mode: 'custom',
    championName: 'random',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots,
  });

  it('resolves every slot to the exact spell class chosen, in the exact slot chosen', () => {
    const slots = ['BasicAttack', 'Yasuo_Q', 'Lux_W', 'Anivia_E', 'Zed_R', 'Ghost', 'Ignite'];
    const preset = getChampionPresetFromLoadout(customLoadout(slots));
    expect(preset.spells).toEqual([
      AllSpells.BasicAttack,
      AllSpells.Yasuo_Q,
      AllSpells.Lux_W,
      AllSpells.Anivia_E,
      AllSpells.Zed_R,
      AllSpells.Ghost,
      AllSpells.Ignite,
    ]);
  });

  it('allows a standalone (non-4-ability) spell in any slot, including one AllSpells has but SpellGroups only lists as a single-ability stub', () => {
    const slots = ['Olaf_Q', 'Graves_W', 'Thresh_Q', 'Rammus_Q', 'Nasus_Q', 'StealthWard', 'Heal'];
    const preset = getChampionPresetFromLoadout(customLoadout(slots));
    expect(preset.spells).toEqual([
      AllSpells.Olaf_Q,
      AllSpells.Graves_W,
      AllSpells.Thresh_Q,
      AllSpells.Rammus_Q,
      AllSpells.Nasus_Q,
      AllSpells.StealthWard,
      AllSpells.Heal,
    ]);
  });

  it('picks a random spell for a "random" slot, and for an unknown/stale id, rather than leaving the slot empty', () => {
    const slots = ['random', 'not-a-real-id', 'Yasuo_Q', 'random', 'random', 'random', 'random'];
    const preset = getChampionPresetFromLoadout(customLoadout(slots));
    expect(preset.spells).toHaveLength(SLOT_COUNT);
    expect(preset.spells[2]).toBe(AllSpells.Yasuo_Q);
    for (const spell of preset.spells)
      expect(barrelKeys).toContain((spell as { name: string }).name);
  });

  it('pads a short customSlots array (e.g. from an older/corrupt save) rather than throwing', () => {
    const preset = getChampionPresetFromLoadout(customLoadout(['Yasuo_Q']));
    expect(preset.spells).toHaveLength(SLOT_COUNT);
    expect(preset.spells[0]).toBe(AllSpells.Yasuo_Q);
  });

  it('gives a custom kit a random avatar, same pool as a fully random champion', () => {
    const preset = getChampionPresetFromLoadout(customLoadout(Array(SLOT_COUNT).fill('random')));
    expect(preset.avatar).toMatch(/^champ_/);
  });
});
