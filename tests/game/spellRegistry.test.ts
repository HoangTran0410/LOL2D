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
import * as CoreSpells from '../../src/game/gameObject/coreSpells/index';
import * as AllSpellFactories from '../../packs/riot/spells/index';
// The reference pack has no barrel index (only four spells, imported by
// `packs/reference/pack.ts` individually) — imported the same way here, for
// the same reason `AllSpellFactories` above is imported directly rather than
// asked of the real `PackRegistry`: this file's own expected values must be
// independent of the registry code under test, and a *second* installed
// pack's champion is exactly as reachable by `planMatchKits`'s random
// selection as the bundled pack's, so this test's own oracle has to know
// about it too (fix round 1 of content-pack-extraction batch 5 task 4 — see
// `AllSpellsByQualifiedId` below).
import makeVeraQ from '../../packs/reference/spells/Vera_Q';
import makeVeraW from '../../packs/reference/spells/Vera_W';
import makeVeraE from '../../packs/reference/spells/Vera_E';
import makeVeraR from '../../packs/reference/spells/Vera_R';
import { buildContentApi } from '../../src/content/ContentApi';
import { DEFAULT_CHAMPION_ATTACK } from '../../src/game/gameObject/attackableUnits/Champion';
import { spellModules as coreSpellModules } from '../../src/generated/spellModules';
import { spellCatalog as coreSpellCatalog } from '../../src/generated/spellCatalog';
import { spellModules as riotSpellModules } from '../../packs/riot/generated/spellModules';
import { spellCatalog as riotSpellCatalog } from '../../packs/riot/generated/spellCatalog';
import {
  allSpellIds,
  isSpellId,
  isSpellLoaded,
  loadSpells,
  loadedSpellIds,
  qualifySpellId,
  randomLoadedId,
  resetSpellRegistryForTests,
  spellClassOfId,
} from '../../src/game/spellRegistry';
import { contentRegistry } from '../../src/content/registry';
import {
  getChampionPresetRandom,
  getChampionPresetFromLoadout,
  loadChampionPresetFromLoadout,
  planLoadout,
  planMatchKits,
  plannedSpellIds,
  presetFromPlan,
  spellGroups,
} from '../../src/game/preset';
import {
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_PREGAME_CONFIG,
  SLOT_COUNT,
  type ChampionLoadout,
} from '../../src/game/config/PregameConfig';


// Every pack spell's `default` export is now `(api: ContentApi) => SpellClass`
// (batch 4 task 3) — resolved once so `AllSpells.X` stays a plain class.
const __api = buildContentApi();
const AllSpells: Record<string, unknown> = Object.fromEntries(
  Object.entries(AllSpellFactories).map(([id, factory]) => [
    id,
    typeof factory === 'function' ? (factory as (api: typeof __api) => unknown)(__api) : factory,
  ])
);

// The registry loads from two barrels now — `spells/` (content) and
// `coreSpells/` (`BasicAttack`) — merged core-last exactly as
// `scripts/generate-spell-catalog.mjs` merges them (core spread after
// content, so it wins a collision). The generated module map and catalogue
// split across the same two trees now — core's own generated files
// (`BasicAttack`) and the riot pack's (everything else) — merged the
// same way.
const AllSpellsById: Record<string, unknown> = { ...AllSpells, ...CoreSpells };
const spellModules: Record<string, unknown> = { ...riotSpellModules, ...coreSpellModules };
const spellCatalog: Record<string, unknown> = { ...riotSpellCatalog, ...coreSpellCatalog };

const barrelKeys = Object.keys(AllSpellsById).filter(
  key => typeof AllSpellsById[key] === 'function'
);

// The reference pack's four spells, resolved against the same `__api` —
// `AllSpells` above only ever covers the bundled (riot) pack, which is
// correct for the module-map/catalogue coverage checks it feeds (those are
// specifically about the riot pack's own generated files), but wrong as the
// *only* source of truth for "what class does this id build" once a second
// pack's champion can be dealt into a real match.
const ReferenceSpells: Record<string, unknown> = {
  Vera_Q: makeVeraQ(__api),
  Vera_W: makeVeraW(__api),
  Vera_E: makeVeraE(__api),
  Vera_R: makeVeraR(__api),
};

/**
 * Every class this build can produce, keyed by the *qualified* id
 * `qualifySpellId`/`PackRegistry` actually use — `riot:<id>` for the bundled
 * pack (which is also where core's own `BasicAttack`/`Recall` live, folded
 * onto it by `install.ts`) and `reference:<id>` for the reference pack.
 *
 * Fix round 1 of content-pack-extraction batch 5 task 4: `"is buildable
 * once"` below used to strip only a `riot:` prefix and look the bare id up
 * in `AllSpellsById` (riot + core only), so a match plan that happened to
 * deal the reference pack's own champion (Vera — `planMatchKits` picks
 * randomly and unseeded, so this was a genuine, roughly 1-in-8 flake, not a
 * hypothetical) computed the wrong expected value: `undefined`, since
 * `AllSpellsById` has no `reference:`-anything and the strip left a
 * `reference:Vera_Q` key untouched. That was a bug in this test's own
 * independent oracle, not in the registry it exercises — deleting Vera from
 * the random pool would have hidden the gap instead of closing it, so the
 * fix is this table covering both installed packs instead.
 */
const AllSpellsByQualifiedId: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(AllSpellsById).map(([id, cls]) => [`riot:${id}`, cls])),
  ...Object.fromEntries(
    Object.entries(ReferenceSpells).map(([id, cls]) => [`reference:${id}`, cls])
  ),
};

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

  it('exposes the ids without loading anything from the dynamic catalogue', () => {
    // `allSpellIds()` is a union across every installed pack now, not just the
    // bundled one — the reference pack contributes its own ids too — so the
    // bundled catalogue is checked as a subset rather than an exact count.
    const riotIds = barrelKeys.map(qualifySpellId);
    for (const id of riotIds) expect(allSpellIds()).toContain(id);
    expect(allSpellIds().length).toBeGreaterThan(barrelKeys.length);
    for (const id of riotIds) expect(loadedSpellIds()).not.toContain(id);
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
    // Every other pack's own eager content (e.g. `riot:Recall`) also shows up
    // in `loadedSpellIds()` now that it reads straight off the registry, so
    // this checks membership rather than the exact set.
    expect(loadedSpellIds()).toContain('riot:Yasuo_Q');
    expect(loadedSpellIds()).not.toContain('riot:NotASpell_Q');
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
    // Registry-qualified now — `QualifiedChampion.spells` is qualified by
    // `PackRegistry.install()`, and `preset.ts`'s `playableKits()` reads a
    // champion's spells straight off that, unlike the old `CHAMPION_KITS` row
    // (bare ids). `classForId`/`isSpellId` both accept either form.
    expect(plan.spellIds.slice(1, 5)).toEqual(
      ['Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R'].map(qualifySpellId)
    );
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
      avatar: 'riot:champ_yasuo',
      // Registry-qualified — see the named-champion case above.
      spellIds: [
        'BasicAttack',
        ...['Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R'].map(qualifySpellId),
        'Flash',
        'Heal',
      ],
      attack: expect.any(Object),
    });
  });

  it('rolls one coherent plan exactly once for a random respawn', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    const preset = getChampionPresetRandom();

    expect(random).toHaveBeenCalledTimes(1);
    expect(preset).toMatchObject({
      name: 'Yasuo',
      avatar: 'riot:champ_yasuo',
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

    // An id that already carries a colon (a named champion's own, e.g.
    // `riot:Yasuo_Q`, or a cross-pack one, e.g. `reference:Vera_Q`) is used
    // as-is; a bare id means the bundled pack, same rule `qualifySpellId`
    // states — but written out again here, independently, rather than
    // imported from `../../src/game/spellRegistry`: this test's expected
    // value must not depend on the function the registry itself uses to
    // compute it, or a bug in that function would cancel out against
    // itself instead of failing here.
    const qualify = (id: string): string => (id.includes(':') ? id : `riot:${id}`);

    for (const kit of [plan.player, ...plan.bots]) {
      const preset = presetFromPlan(kit);
      expect(preset.spells).toHaveLength(SLOT_COUNT);
      // Every slot is the exact class its id names — no fallbacks fired.
      // `AllSpellsByQualifiedId` covers every installed pack (riot and
      // reference), not just the bundled one, since `planMatchKits` picks a
      // champion at random across all of them and this oracle must too.
      kit.spellIds.forEach((id, slot) => {
        const expected = AllSpellsByQualifiedId[qualify(id)];
        // Guards the guard, fix round 2: `toBe` alone is satisfied by two
        // absences (`undefined === undefined`) — an id from a pack this
        // oracle does not know would silently agree with a real fallback or
        // a real miss instead of failing the "no fallbacks fired" claim
        // this test exists to check. Asserting the oracle itself has an
        // answer first turns that silent pass into a named failure.
        expect(expected, `no oracle entry for ${qualify(id)} (slot ${slot})`).not.toBeUndefined();
        expect(preset.spells![slot]).toBe(expected);
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
      avatar: 'riot:champ_yasuo',
      attack: DEFAULT_CHAMPION_ATTACK,
      spellIds: ['Ahri_Q'],
    });
    expect(preset.spells).toHaveLength(1);
    expect(preset.spells![0]).toBe(CoreSpells.BasicAttack);
  });

  it('still builds a kit with nothing loaded at all', () => {
    // "Nothing loaded" now means none of the dynamically-imported catalogue —
    // a pack may always carry a few eager classes (`riot:Recall`, the whole
    // reference pack), so `randomLoadedId()` is no longer guaranteed null.
    for (const id of barrelKeys) expect(isSpellLoaded(id)).toBe(false);
    expect(randomLoadedId()).toBeTypeOf('string');
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

describe('resolving through the pack registry', () => {
  it('resolves an unqualified id against the bundled pack', async () => {
    resetSpellRegistryForTests();
    await loadSpells(['Yasuo_Q']);
    expect(spellClassOfId('Yasuo_Q')).toBeTypeOf('function');
    expect(spellClassOfId('riot:Yasuo_Q')).toBe(spellClassOfId('Yasuo_Q'));
  });

  it('resolves a pack-qualified id that is not the bundled pack', async () => {
    resetSpellRegistryForTests();
    await loadSpells(['reference:Vera_Q']);
    expect(spellClassOfId('reference:Vera_Q')).toBeTypeOf('function');
  });

  it('knows an id from every installed pack', () => {
    expect(isSpellId('Yasuo_Q')).toBe(true);
    expect(isSpellId('reference:Vera_Q')).toBe(true);
    expect(isSpellId('Nobody_Q')).toBe(false);
  });

  it('leaves Recall out of the pool a random slot is drawn from', () => {
    // Declared by the bundled pack so a champion's `recall` can name it, and
    // given no display data so it can never be rendered — which is also what
    // keeps it out of here. A HELD channel dealt into an ability slot would be
    // drawn by a HUD with no name and no icon for it.
    expect(contentRegistry().hasSpell('riot:Recall')).toBe(true);
    expect(isSpellId('Recall')).toBe(false);
    expect(allSpellIds()).not.toContain('riot:Recall');
    // Derived, not `> 200`: the pool has to be at least as big as the
    // bundled pack's own barrel, which is the population this programme
    // keeps moving. Same oracle the "exposes the ids without loading
    // anything" case above already uses.
    expect(allSpellIds().length).toBeGreaterThanOrEqual(barrelKeys.length);
  });

  it('still fires onSettled once per id, including for an unknown one', async () => {
    resetSpellRegistryForTests();
    const settled: string[] = [];
    await loadSpells(['Yasuo_Q', 'Nobody_Q', 'Yasuo_Q'], id => settled.push(id));
    // Multiset, not sequence: the documented contract is "once per id in
    // `ids`, after that id is done" — it says nothing about order, and
    // `GameScene`'s progress bar wants completion order, not request order.
    // Asserting an exact ordered array here would force notification to
    // queue behind whichever entry sits earliest in `ids`, which is exactly
    // the regression that stalls the bar on a slow chunk and then jumps it
    // several steps at once.
    expect([...settled].sort()).toEqual(['Nobody_Q', 'Yasuo_Q', 'Yasuo_Q']);
  });

  it('qualifies a bare id against the bundled pack and leaves a qualified one alone', () => {
    expect(qualifySpellId('Yasuo_Q')).toBe('riot:Yasuo_Q');
    expect(qualifySpellId('reference:Vera_Q')).toBe('reference:Vera_Q');
  });
});

/**
 * `preset.ts` is the last consumer to move off `CHAMPION_KITS` and onto
 * `contentRegistry()` — Task 8 of the content-pack-extraction plan.
 */
describe('preset.ts reads the pack registry', () => {
  // Vera (`reference:vera`) now has a portrait and `playable: true` — Task 10
  // — so `playableKits()` (this file's `PlayableChampionKit` table) can offer
  // her by name, the same rule `tests/scenes/pregameCatalog.test.ts` already
  // documents for the roster.
  it('can plan a match around a champion from a non-bundled pack', async () => {
    resetSpellRegistryForTests();
    await loadSpells([
      'reference:Vera_Q',
      'reference:Vera_W',
      'reference:Vera_E',
      'reference:Vera_R',
    ]);
    const plan = planLoadout({ ...DEFAULT_CHAMPION_LOADOUT, championName: 'Vera' });
    expect(plan.name).toBe('Vera');
    expect(plan.spellIds).toContain('reference:Vera_Q');
  });

  // `spellGroups()` is not gated on `playable` — it always mapped every
  // `CHAMPION_KITS` row, shelf stubs included, and now maps every installed
  // champion the same way — so it is the one place this task's registry read
  // is observable today without waiting on Vera's portrait.
  it('spellGroups() includes a champion from a pack that is not the bundled one', async () => {
    resetSpellRegistryForTests();
    await loadSpells([
      'reference:Vera_Q',
      'reference:Vera_W',
      'reference:Vera_E',
      'reference:Vera_R',
    ]);

    const vera = spellGroups().find(group => group.name === 'Vera');
    expect(vera).toBeDefined();
    // Real resolved classes, not the BasicAttack fallback — proves the ids
    // came off `champion.spells` and were actually loaded, not guessed.
    // Compared against each class's own declared name rather than against
    // `spellClassOfId`/`classForId` again, so this does not verify the
    // resolver by calling the resolver.
    expect(vera?.spells.map(spellClass => (spellClass as { name: string }).name)).toEqual([
      'Vera_Q',
      'Vera_W',
      'Vera_E',
      'Vera_R',
    ]);
  });

  it('still plans every riot champion it could plan before packs, by name', () => {
    // Parity guard: every full-kit `CHAMPION_KITS` row must still resolve to
    // its own Q/W/E/R through the registry-backed `playableKits()`, not just
    // the one row (`Yasuo`) the tests above happen to exercise.
    const named = ['Ahri', "Cho'Gath", 'Jinx', 'Irelia'];
    for (const name of named) {
      const plan = planLoadout({ ...DEFAULT_CHAMPION_LOADOUT, championName: name });
      expect(plan.name).toBe(name);
      expect(plan.spellIds.slice(1, 5)).toEqual(
        [
          `${name.replace("'", '')}_Q`,
          `${name.replace("'", '')}_W`,
          `${name.replace("'", '')}_E`,
          `${name.replace("'", '')}_R`,
        ].map(qualifySpellId)
      );
    }
  });
});
