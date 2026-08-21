import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import { getPregameCatalog, matchesQuery } from '../../src/scenes/setup/pregameCatalog';
import { CHAMPION_KITS } from '../../src/game/config/spellCatalog';

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

  it('keeps them in CHAMPION_KITS order rather than sorting them too', () => {
    const source = CHAMPION_KITS.map(group => group.name);
    const pinnedNames = pinned.map(shelf => shelf.name);
    const bySource = [...pinnedNames].sort((a, b) => source.indexOf(a) - source.indexOf(b));
    expect(pinnedNames).toEqual(bySource);
  });

  it('sorts the champions by name', () => {
    const names = champions.map(shelf => shelf.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('really did reorder — the champions are not still in CHAMPION_KITS order', () => {
    // Without this the sort assertion above passes on an accident: a source
    // list that happened to be alphabetical would satisfy it having done
    // nothing. `CHAMPION_KITS` starts Yasuo, Shaco, Ahri, so it is not.
    const source = CHAMPION_KITS.filter(group => group.spells.length === 4).map(
      group => group.name
    );
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
 * The roster now reads the pack registry (`contentRegistry()`) instead of
 * `CHAMPION_KITS` directly — Task 7 of the content-pack-extraction plan.
 */
describe('the roster reads the pack registry', () => {
  // Vera (`reference:vera`) now has a portrait and `playable: true` — Task 10.
  it('offers a champion from a pack that is not the bundled one', () => {
    const names = getPregameCatalog().champions.map(c => c.name);
    expect(names).toContain('Vera');
  });

  // `arrayContaining`, not exact equality: `CHAMPION_KITS` is only the
  // bundled pack's own static data, so it never gained Vera and never will —
  // the guarantee this test makes is that packs add to the roster, they
  // don't remove from it.
  it('still offers every champion it offered before packs', () => {
    const names = getPregameCatalog().champions.map(c => c.name);
    const before = CHAMPION_KITS.filter(k => k.image && k.spells.length === 4).map(k => k.name);
    expect(before.length).toBeGreaterThan(20);
    expect(names).toEqual(expect.arrayContaining(before));
  });
});
