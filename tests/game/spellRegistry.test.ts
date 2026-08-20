/**
 * The contract that makes lazy spell loading safe.
 *
 * Spell classes arrive by dynamic import now, one chunk per champion, while the
 * engine that consumes them is entirely synchronous — `Game`'s constructor
 * builds every unit inline, `AIChampion` re-rolls inside `update()`, and
 * `MatchDirector` swaps a live kit from a click handler. Nothing in there can
 * await, so the safety comes from ordering instead:
 *
 *   plan (ids, no modules needed) → load (exactly those) → build (classes)
 *
 * Which holds only while three things are true, and each one fails silently:
 *
 *  1. The generated module map covers every id the catalogue offers — otherwise
 *     a spell is pickable in the pregame screen and unloadable in a match.
 *  2. A plan never names an id the map cannot load.
 *  3. A miss degrades instead of throwing, because a re-roll mid-match can
 *     legitimately name something that has not arrived yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn((key: string) => ({ key, url: `url:${key}` })),
    getAsset: vi.fn(() => undefined),
    placeholder: vi.fn(() => ({ url: 'x' })),
  },
}));

import * as AllSpells from '../../src/game/gameObject/spells/index';
import * as CoreSpells from '../../src/game/gameObject/coreSpells/index';
import { DEFAULT_CHAMPION_ATTACK } from '../../src/game/gameObject/attackableUnits/Champion';
import { spellModules } from '../../src/generated/spellModules';
import { spellCatalog } from '../../src/generated/spellCatalog';
import {
  allSpellIds,
  isSpellId,
  isSpellLoaded,
  loadSpells,
  loadedSpellIds,
  randomLoadedId,
  resetSpellRegistryForTests,
  spellClassOfId,
} from '../../src/game/spellRegistry';
import {
  getChampionPresetRandom,
  getChampionPresetFromLoadout,
  loadChampionPresetFromLoadout,
  planLoadout,
  planMatchKits,
  plannedSpellIds,
  presetFromPlan,
} from '../../src/game/preset';
import {
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_PREGAME_CONFIG,
  SLOT_COUNT,
  type ChampionLoadout,
} from '../../src/game/config/PregameConfig';

// The registry loads from two barrels now — `spells/` (content) and
// `coreSpells/` (`BasicAttack`) — merged content-last exactly as
// `scripts/generate-spell-catalog.mjs` merges them.
const AllSpellsById: Record<string, unknown> = { ...AllSpells, ...CoreSpells };

const barrelKeys = Object.keys(AllSpellsById).filter(
  key => typeof AllSpellsById[key] === 'function'
);

beforeEach(() => resetSpellRegistryForTests());
afterEach(() => vi.restoreAllMocks());

describe('the generated module map', () => {
  it('covers exactly the spells the barrel exports', () => {
    expect(new Set(Object.keys(spellModules))).toEqual(new Set(barrelKeys));
  });

  it('covers exactly the ids the pregame catalogue offers', () => {
    // The screen lets a player pick any of these; every one must be loadable.
    expect(new Set(Object.keys(spellModules))).toEqual(new Set(Object.keys(spellCatalog)));
  });

  it('exposes the ids without loading anything', () => {
    expect(allSpellIds()).toHaveLength(barrelKeys.length);
    expect(loadedSpellIds()).toEqual([]);
    expect(isSpellId('Yasuo_Q')).toBe(true);
    expect(isSpellId('Yasuo_T')).toBe(false);
  });
});

describe('loading', () => {
  it('fetches a module and answers for it synchronously afterwards', async () => {
    expect(spellClassOfId('Yasuo_Q')).toBeNull();
    await loadSpells(['Yasuo_Q']);
    expect(isSpellLoaded('Yasuo_Q')).toBe(true);
    expect(spellClassOfId('Yasuo_Q')).toBe(AllSpells.Yasuo_Q);
  });

  it('loads a repeated or unknown id without complaint', async () => {
    await loadSpells(['Yasuo_Q', 'Yasuo_Q', 'NotASpell_Q']);
    expect(loadedSpellIds()).toEqual(['Yasuo_Q']);
  });

  it('deduplicates concurrent requests for the same module', async () => {
    // Six bots rolling the same champion must not fetch it six times.
    await Promise.all([loadSpells(['Ahri_Q']), loadSpells(['Ahri_Q']), loadSpells(['Ahri_Q'])]);
    expect(spellClassOfId('Ahri_Q')).toBe(AllSpells.Ahri_Q);
  });

  it('loads an exact live loadout before building its preset', async () => {
    const lux = { ...DEFAULT_CHAMPION_LOADOUT, championName: 'Lux' };
    expect(isSpellLoaded('Lux_Q')).toBe(false);

    const preset = await loadChampionPresetFromLoadout(lux);

    expect(preset.name).toBe('Lux');
    expect(preset.spells?.slice(1, 5)).toEqual([
      AllSpells.Lux_Q,
      AllSpells.Lux_W,
      AllSpells.Lux_E,
      AllSpells.Lux_R,
    ]);
  });
});

describe('a match plan', () => {
  const loadout = (over: Partial<ChampionLoadout> = {}): ChampionLoadout => ({
    ...DEFAULT_CHAMPION_LOADOUT,
    customSlots: [...DEFAULT_CHAMPION_LOADOUT.customSlots],
    ...over,
  });

  it('names only ids the registry can load — for a named champion', () => {
    const plan = planLoadout(loadout({ championName: 'Yasuo' }));
    expect(plan.spellIds).toHaveLength(SLOT_COUNT);
    for (const id of plan.spellIds) expect(isSpellId(id)).toBe(true);
    expect(plan.spellIds.slice(1, 5)).toEqual(['Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R']);
  });

  it('names only ids the registry can load — for a random champion', () => {
    // Random is a champion choice, not a free-form spell shuffle: its portrait,
    // name, Q/W/E/R and attack profile must all come from one catalogue row.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const plan = planLoadout(loadout({ championName: 'random' }));

    expect(plan.spellIds).toHaveLength(SLOT_COUNT);
    for (const id of plan.spellIds) expect(isSpellId(id)).toBe(true);
    expect(plan).toMatchObject({
      name: 'Yasuo',
      avatar: 'champ_yasuo',
      spellIds: ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R', 'Flash', 'Heal'],
      attack: expect.any(Object),
    });
  });

  it('rolls one coherent plan exactly once for a random respawn', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    const preset = getChampionPresetRandom();

    expect(random).toHaveBeenCalledTimes(1);
    expect(preset).toMatchObject({
      name: 'Yasuo',
      avatar: 'champ_yasuo',
      attack: expect.any(Object),
    });
  });

  it('carries a named champion attack profile through plan and preset', async () => {
    const plan = planLoadout(loadout({ championName: 'Yasuo' }));
    await loadSpells(plan.spellIds);

    expect(plan).toMatchObject({
      attack: { damage: 17, attacksPerSecond: 1.1, range: 130 },
    });
    expect(presetFromPlan(plan)).toMatchObject({
      attack: { damage: 17, attacksPerSecond: 1.1, range: 130 },
    });
  });

  it('names only ids the registry can load — for a custom kit with a stale slot', () => {
    const plan = planLoadout(
      loadout({ mode: 'custom', customSlots: ['Yasuo_Q', 'AChampionWeDeleted_R', 'random'] })
    );
    expect(plan.spellIds).toHaveLength(SLOT_COUNT);
    for (const id of plan.spellIds) expect(isSpellId(id)).toBe(true);
    expect(plan.spellIds[0]).toBe('Yasuo_Q');
  });

  it('covers every unit in the match, deduplicated', () => {
    const plan = planMatchKits(DEFAULT_PREGAME_CONFIG);
    expect(plan.bots).toHaveLength(DEFAULT_PREGAME_CONFIG.ai.count);

    const ids = plannedSpellIds(plan);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kit of [plan.player, ...plan.bots]) {
      for (const id of kit.spellIds) expect(ids).toContain(id);
    }
  });

  it('is buildable once — and only once — its ids are loaded', async () => {
    const plan = planMatchKits(DEFAULT_PREGAME_CONFIG);
    await loadSpells(plannedSpellIds(plan));

    for (const kit of [plan.player, ...plan.bots]) {
      const preset = presetFromPlan(kit);
      expect(preset.spells).toHaveLength(SLOT_COUNT);
      // Every slot is the exact class its id names — no fallbacks fired.
      kit.spellIds.forEach((id, slot) => {
        expect(preset.spells![slot]).toBe(AllSpellsById[id]);
      });
    }
  });

  it('loads far less than the whole catalogue for a default match', () => {
    // The point of the exercise. Six units of seven slots cannot need 238
    // modules; if this ever approaches the catalogue size, planning has stopped
    // narrowing anything.
    const ids = plannedSpellIds(planMatchKits(DEFAULT_PREGAME_CONFIG));
    expect(ids.length).toBeLessThanOrEqual((DEFAULT_PREGAME_CONFIG.ai.count + 1) * SLOT_COUNT);
    expect(ids.length).toBeLessThan(allSpellIds().length / 2);
  });
});

describe('a miss degrades instead of throwing', () => {
  it('falls back only to BasicAttack when a known id has not arrived', async () => {
    await loadSpells(['Yasuo_Q']);
    // `Ahri_Q` is a real id whose module has not been fetched — the shape of a
    // mid-match re-roll that beat `loadRemainingSpells` to it.
    const preset = presetFromPlan({
      name: 'x',
      avatar: 'champ_yasuo',
      attack: DEFAULT_CHAMPION_ATTACK,
      spellIds: ['Ahri_Q'],
    });
    expect(preset.spells).toHaveLength(1);
    expect(preset.spells![0]).toBe(CoreSpells.BasicAttack);
  });

  it('still builds a kit with nothing loaded at all', () => {
    expect(randomLoadedId()).toBeNull();
    const preset = getChampionPresetFromLoadout(DEFAULT_CHAMPION_LOADOUT);
    expect(preset.spells).toHaveLength(SLOT_COUNT);
    for (const spellClass of preset.spells!) expect(typeof spellClass).toBe('function');
  });

  it('can see the coverage gap it is meant to catch', () => {
    // The first two tests in this file compare two generated sets; this proves
    // that comparison would actually fail if one lost an entry.
    const withHole = new Set(Object.keys(spellModules));
    withHole.delete('Yasuo_Q');
    expect(withHole).not.toEqual(new Set(barrelKeys));
  });
});
