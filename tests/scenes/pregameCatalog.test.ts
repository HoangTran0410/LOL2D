import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import { getPregameCatalog, matchesQuery } from '../../src/scenes/setup/pregameCatalog';
import {
  isSpellCatalogId,
  listSelectableChampions,
  spellDisplayOf,
} from '../../src/game/config/spellCatalog';
// The riot pack's own roster, moved out of `CHAMPION_KITS`
// (`src/game/config/spellCatalog.ts`) and into `packs/riot/data.ts` — batch
// 4 task 7. Used below only as an independent source to compare the
// registry-backed catalogue's order/membership against, the same role
// `CHAMPION_KITS` played here before the move.
import { data as riotData } from '../../packs/riot/pack';

/**
 * The roster's order, and the two shelves that are not a champion.
 *
 * The list is ~50 shelves deep now, so it is sorted by name — but Đánh Thường
 * and Phép Bổ Trợ sorted into the middle of the alphabet with everyone else,
 * which put the basic attack between Cassiopeia and Fizz. They are pinned to
 * the front instead, and the champions sort under them.
 *
 * `kit.length === 0` is the pin, deliberately reusing the predicate that
 * already decides whether a shelf gets a whole-kit button and whether compact
 * mode shows it at all. `championName === null` would have been the wrong one:
 * a partial shelf (abilities, but not a full four with a portrait) has no
 * `championName` and yet is very much a champion's row.
 */
const catalog = getPregameCatalog();

describe('the roster pins the two non-champion shelves and sorts the rest', () => {
  const pinned = catalog.kitShelves.filter(shelf => shelf.kit.length === 0);
  const champions = catalog.kitShelves.filter(shelf => shelf.kit.length > 0);

  it('has both non-champion shelves', () => {
    expect(pinned.map(shelf => shelf.name)).toEqual(['Đánh Thường', 'Phép Bổ Trợ']);
  });

  it('puts them first, before any champion', () => {
    const firstChampionAt = catalog.kitShelves.findIndex(shelf => shelf.kit.length > 0);
    expect(firstChampionAt).toBe(pinned.length);
  });

  it("keeps them in the roster's own order rather than sorting them too", () => {
    const source = (riotData.champions ?? []).map(champion => champion.name);
    const pinnedNames = pinned.map(shelf => shelf.name);
    const bySource = [...pinnedNames].sort((a, b) => source.indexOf(a) - source.indexOf(b));
    expect(pinnedNames).toEqual(bySource);
  });

  it('sorts the champions by name', () => {
    const names = champions.map(shelf => shelf.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("really did reorder — the champions are not still in the roster's own order", () => {
    // Without this the sort assertion above passes on an accident: a source
    // list that happened to be alphabetical would satisfy it having done
    // nothing. The roster starts Yasuo, Shaco, Ahri, so it is not.
    const source = (riotData.champions ?? [])
      .filter(champion => champion.spells.length === 4)
      .map(champion => champion.name);
    expect(champions.map(shelf => shelf.name)).not.toEqual(source);
  });
});

/**
 * Which shelf serves a slot that no champion ability can fill. Compact mode
 * hides both, and reveals exactly one of them when the selected slot is A, D
 * or F — see `LoadoutEditorModal.revealShelf`.
 *
 * Derived from the catalogue, never from the display name: matching
 * `'Phép Bổ Trợ'` as a string would break the moment the label is retranslated
 * and would say nothing at all in a test that also reads the label.
 */
describe('each non-champion shelf knows what it serves', () => {
  it('names exactly one basic-attack shelf and one summoner shelf', () => {
    const kinds = catalog.kitShelves.map(shelf => shelf.nonChampionKind).filter(Boolean);
    expect(kinds.sort()).toEqual(['basicAttack', 'summoner']);
  });

  it('the summoner shelf holds every summoner spell and nothing else', () => {
    const shelf = catalog.kitShelves.find(s => s.nonChampionKind === 'summoner');
    const ids = shelf?.entries.map(e => e.entry.id).sort();
    expect(ids).toEqual(catalog.summoners.map(s => s.id).sort());
  });

  it('every champion shelf is left unmarked', () => {
    const marked = catalog.kitShelves.filter(
      shelf => shelf.kit.length > 0 && shelf.nonChampionKind !== null
    );
    expect(marked.map(shelf => shelf.name)).toEqual([]);
  });
});

describe('searching the roster by name', () => {
  /**
   * The roster is ~50 champion tiles in one scrolling list, so finding one by
   * eye means scrolling past forty. `matchesQuery` is what the picker's search
   * box filters on, and it is a plain substring test with two foldings:
   *
   *  - **case**, because nobody types a capital;
   *  - **accents**, because the player types on a Vietnamese keyboard and a
   *    saved kit is very likely to be named in Vietnamese. Riot's champion
   *    names carry none, so this half only ever pays off on the saved-kit
   *    shelf — which is filtered by the same box, being the other named thing
   *    on the screen.
   */
  it('matches a substring anywhere in the name', () => {
    expect(matchesQuery('Cassiopeia', 'ssio')).toBe(true);
    expect(matchesQuery('Cassiopeia', 'Cass')).toBe(true);
    expect(matchesQuery('Cassiopeia', 'zed')).toBe(false);
  });

  it('ignores case and surrounding space', () => {
    expect(matchesQuery('Master Yi', 'YI')).toBe(true);
    expect(matchesQuery('Master Yi', '  master  ')).toBe(true);
  });

  it('ignores Vietnamese accents on both sides', () => {
    expect(matchesQuery('Bộ chiêu để dành', 'bo chieu')).toBe(true);
    expect(matchesQuery('Bo chieu de danh', 'bộ chiêu')).toBe(true);
  });

  it('matches everything on an empty query, so a cleared box restores the list', () => {
    for (const query of ['', '   ']) {
      expect(matchesQuery('Ashe', query)).toBe(true);
    }
  });

  it('finds every champion in the catalogue by its own name', () => {
    // Not a tautology: it is the guard against a folding that mangles a real
    // name — an over-eager strip that ate an apostrophe or a space would leave
    // `Kha'Zix` unfindable by typing exactly what the tile says.
    for (const shelf of catalog.kitShelves) {
      expect(matchesQuery(shelf.name, shelf.name), shelf.name).toBe(true);
    }
  });
});

/**
 * The roster now reads the pack registry (`contentRegistry()`) instead of a
 * module-scope constant — `packs/riot/data.ts`'s own roster (`CHAMPION_KITS`,
 * as it used to be called here) is not that constant either, since Task 7 of
 * the content-pack-extraction plan; it is real pack content, read the same
 * way the reference pack's is.
 */
describe('the roster reads the pack registry', () => {
  // Vera (`reference:vera`) now has a portrait and `playable: true` — Task 10.
  it('offers a champion from a pack that is not the bundled one', () => {
    const names = getPregameCatalog().champions.map(c => c.name);
    expect(names).toContain('Vera');
  });

  // `arrayContaining`, not exact equality: the riot pack's own roster is
  // only its static data, so it never gained Vera and never will — the
  // guarantee this test makes is that packs add to the roster, they don't
  // remove from it.
  it('still offers every champion it offered before packs', () => {
    const names = getPregameCatalog().champions.map(c => c.name);
    const before = (riotData.champions ?? [])
      .filter(champion => champion.image && champion.spells.length === 4)
      .map(champion => champion.name);
    expect(before.length).toBeGreaterThan(20);
    expect(names).toEqual(expect.arrayContaining(before));
  });
});

/**
 * Every id the pregame catalogue can hand a player — off a champion's shelf
 * or off a champion's `spells` row — has to be a *real* id: something
 * `spellDisplayOf` can resolve to real display data and `isSpellCatalogId`
 * recognises. This is deliberately a population-level walk rather than a case
 * naming Vera: a test that named Vera specifically would pass again the
 * moment a third pack shipped the same bug (a picker entry keyed by its own
 * bare id instead of the registry-qualified one), so this instead demands
 * the invariant of every id both `getPregameCatalog()`'s shelves and
 * `listSelectableChampions()` can offer, regardless of which pack it came
 * from.
 */
describe('every id the picker can offer resolves to real display data', () => {
  it('has display data and passes isSpellCatalogId, for every offered id', () => {
    const ids = new Set<string>();
    for (const shelf of catalog.kitShelves) {
      for (const shelfEntry of shelf.entries) ids.add(shelfEntry.entry.id);
    }
    for (const champion of listSelectableChampions()) {
      for (const spell of champion.spells) ids.add(spell.id);
    }
    // Guards the walk itself: an empty set would make the loop below pass
    // vacuously and prove nothing.
    expect(ids.size).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const id of ids) {
      const display = spellDisplayOf(id);
      const missingDisplay =
        display.name === '?' &&
        display.description === '' &&
        display.coolDownMs === 0 &&
        display.manaCost === 0;
      if (missingDisplay || !isSpellCatalogId(id)) broken.push(id);
    }
    expect(broken).toEqual([]);
  });
});
