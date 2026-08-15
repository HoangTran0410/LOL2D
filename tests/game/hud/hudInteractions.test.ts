import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHudInteractions,
  filterSpells,
  TAP_MOVE_TOLERANCE_PX,
  type SpellItemDisplay,
} from '../../../src/game/hud/hudInteractions';

const spell = (overrides: Partial<SpellItemDisplay>): SpellItemDisplay => ({
  name: 'Quả Cầu Ma Thuật',
  image: '',
  description: 'Phóng quả cầu theo hướng chỉ định',
  coolDown: 6000,
  manaCost: 40,
  spellClass: class {},
  assetKey: null,
  ...overrides,
});

describe('filterSpells', () => {
  const spells = [
    spell({ name: 'Ahri Q', description: 'a magic orb' }),
    spell({ name: 'Yasuo Q', description: 'steel tempest, a sword slash' }),
    spell({ name: 'Ném Băng', description: 'làm chậm mục tiêu' }),
  ];

  it('returns everything when the search is empty', () => {
    expect(filterSpells(spells, '')).toHaveLength(3);
  });

  it('matches on the name, case-insensitively', () => {
    expect(filterSpells(spells, 'yasuo').map(s => s.name)).toEqual(['Yasuo Q']);
  });

  it('matches on the description', () => {
    expect(filterSpells(spells, 'sword').map(s => s.name)).toEqual(['Yasuo Q']);
  });

  it("is accent-insensitive, the way removeAccents' NFD stripping supports", () => {
    // "Ném Băng" without the diacritics should still find it — the same
    // normalize('NFD') + combining-mark strip that `removeAccents` (and this
    // search) is built on. Note this does *not* cover every Vietnamese
    // letter: 'Đ'/'đ' is a distinct base letter, not a decomposable accent,
    // so a search for it has the same limitation the rest of the app already
    // has via `removeAccents` — not a regression introduced here.
    expect(filterSpells(spells, 'nem bang').map(s => s.name)).toEqual(['Ném Băng']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterSpells(spells, 'nonexistent-champion')).toEqual([]);
  });
});

describe('hudInteractions tuning constants', () => {
  it('the drag tolerance is wider than jitter, narrower than a deliberate move', () => {
    expect(TAP_MOVE_TOLERANCE_PX).toBeGreaterThan(4);
    expect(TAP_MOVE_TOLERANCE_PX).toBeLessThan(40);
  });
});

describe('createHudInteractions — the ways into the practice panel', () => {
  const fakeGame = () =>
    ({
      player: { spells: [{}, {}] },
      objectManager: { objects: [] },
      pause: vi.fn(),
      unpause: vi.fn(),
    }) as any;

  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the corner button opens the panel with no slot in mind, and pauses', () => {
    const game = fakeGame();
    const hud = createHudInteractions(game);
    hud.openSpellPicker();
    expect(hud.showSpellsPicker).toBe(true);
    expect(hud.editPlayerSlot).toBeNull();
    expect(game.pause).toHaveBeenCalledOnce();
  });

  it('always opens: a second press cannot toggle an open panel shut', () => {
    const hud = createHudInteractions(fakeGame());
    hud.openSpellPicker();
    hud.openSpellPicker();
    expect(hud.showSpellsPicker).toBe(true);
  });

  /**
   * The desktop strip's per-icon shortcut. `RosterTab` reads `editPlayerSlot`
   * on mount to open the player's loadout editor on that slot — the gesture
   * the deleted picker's `changeSpell(index)` used to carry.
   */
  it('a strip icon opens the panel carrying the slot that was clicked', () => {
    const game = fakeGame();
    const hud = createHudInteractions(game);
    hud.openPlayerLoadout(3);
    expect(hud.showSpellsPicker).toBe(true);
    expect(hud.editPlayerSlot).toBe(3);
    expect(game.pause).toHaveBeenCalledOnce();
  });

  it('closing clears the requested slot, so reopening does not reopen the editor', () => {
    const game = fakeGame();
    const hud = createHudInteractions(game);
    hud.openPlayerLoadout(3);
    hud.closeSpellPicker();
    expect(hud.showSpellsPicker).toBe(false);
    expect(hud.editPlayerSlot).toBeNull();
    expect(game.unpause).toHaveBeenCalledOnce();
  });
});
