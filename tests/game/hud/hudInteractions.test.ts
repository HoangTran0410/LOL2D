import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHudInteractions,
  filterSpells,
  LONG_PRESS_MS,
  LONG_PRESS_DISMISS_MS,
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

  it('is accent-insensitive, the way removeAccents\' NFD stripping supports', () => {
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
  it('holds a long press well past a tap and well short of feeling stuck', () => {
    expect(LONG_PRESS_MS).toBeGreaterThan(200);
    expect(LONG_PRESS_MS).toBeLessThan(800);
  });

  it('dismisses the description some time after the long press', () => {
    expect(LONG_PRESS_DISMISS_MS).toBeGreaterThan(LONG_PRESS_MS);
  });

  it('the drag tolerance is wider than jitter, narrower than a deliberate move', () => {
    expect(TAP_MOVE_TOLERANCE_PX).toBeGreaterThan(4);
    expect(TAP_MOVE_TOLERANCE_PX).toBeLessThan(40);
  });
});

describe('createHudInteractions — touch tap vs. drag vs. long-press', () => {
  /**
   * A bot as `confirmPicks` uses one: two slots and the typed respawn switch
   * `MatchDirector`/`AIChampion` expose, which is what "clone my spells" flips.
   */
  const fakeBot = () => ({
    spells: [{}, {}],
    replaceSpell: vi.fn(),
    replaceSpells: vi.fn(),
    setRespawnRollsNewPreset: vi.fn(),
  });

  const fakeGame = (bots: ReturnType<typeof fakeBot>[] = []) => {
    const player: any = {
      spells: [{}, {}],
      replaceSpell: vi.fn(),
      replaceSpells: vi.fn(),
    };
    return {
      player,
      objectManager: { objects: [] },
      // `confirmPicks` asks the director who is in the match rather than
      // filtering the object list itself — see `MatchDirector.bots()`.
      director: { bots: () => bots },
      pause: vi.fn(),
      unpause: vi.fn(),
    } as any;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // `window.setTimeout`/`clearTimeout` are called explicitly rather than
    // the bare globals, so the tests need *a* window object; the real
    // timers underneath are the same fake ones vitest installed above.
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const touchAt = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

  it('a short tap that never moves fires onTap', () => {
    const hud = createHudInteractions(fakeGame());
    const onTap = vi.fn();
    hud.touchSpellStart({}, touchAt(100, 100));
    hud.touchSpellEnd(onTap);
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('a hold past the long-press window does not fire onTap on release', () => {
    const hud = createHudInteractions(fakeGame());
    const onTap = vi.fn();
    hud.touchSpellStart({}, touchAt(100, 100));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    hud.touchSpellEnd(onTap);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a drag past the tolerance does not fire onTap, even released quickly', () => {
    const hud = createHudInteractions(fakeGame());
    const onTap = vi.fn();
    hud.touchSpellStart({}, touchAt(100, 100));
    hud.touchSpellMove(touchAt(100, 100 + TAP_MOVE_TOLERANCE_PX + 5));
    hud.touchSpellEnd(onTap);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('jitter inside the tolerance still counts as a tap', () => {
    const hud = createHudInteractions(fakeGame());
    const onTap = vi.fn();
    hud.touchSpellStart({}, touchAt(100, 100));
    hud.touchSpellMove(touchAt(100 + TAP_MOVE_TOLERANCE_PX / 2, 100));
    hud.touchSpellEnd(onTap);
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('a drag cancels the pending long-press timer, so it cannot still fire later', () => {
    const hud = createHudInteractions(fakeGame());
    hud.touchSpellStart({}, touchAt(100, 100));
    hud.touchSpellMove(touchAt(100, 100 + TAP_MOVE_TOLERANCE_PX + 5));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(hud.spellHover).toBeNull();
  });

  describe('openSpellPicker', () => {
    // The mobile corner button's entry point: it does not arrive already
    // knowing which slot the player wants, unlike changeSpell(index), so it
    // has to pick a sensible default for the in-modal slot selector to
    // start from.
    it('opens the picker targeting the first ability slot (index 1) by default', () => {
      const game = fakeGame();
      const hud = createHudInteractions(game);
      hud.openSpellPicker();
      expect(hud.showSpellsPicker).toBe(true);
      expect(hud.spellIndexToSwap).toBe(1);
      expect(game.pause).toHaveBeenCalledOnce();
    });

    it('always opens, unlike changeSpell it does not toggle an already-open picker shut', () => {
      const hud = createHudInteractions(fakeGame());
      hud.openSpellPicker();
      hud.openSpellPicker();
      expect(hud.showSpellsPicker).toBe(true);
    });
  });

  describe('pick / confirmPicks — batched apply', () => {
    // Opening seeds `draftSpells` to the player's slot count, which every
    // pick then edits. The whole point of the draft: a pick stages, and
    // nothing reaches the game until confirmPicks.
    const openWithDraft = (game: any) => {
      const hud = createHudInteractions(game);
      hud.openSpellPicker();
      return hud;
    };

    it('pick stages into the draft without applying or closing the picker', () => {
      const game = fakeGame();
      const hud = openWithDraft(game);
      hud.spellIndexToSwap = 1;
      hud.pick(spell({ name: 'Chọn Thử' }));
      expect(hud.draftSpells[1]?.name).toBe('Chọn Thử');
      expect(game.player.replaceSpell).not.toHaveBeenCalled();
      expect(hud.showSpellsPicker).toBe(true);
    });

    it('confirmPicks applies each staged slot, then closes and clears the draft', () => {
      const game = fakeGame();
      const hud = openWithDraft(game);
      hud.spellIndexToSwap = 1;
      hud.pick(spell({ name: 'Chốt Hạ' }));
      hud.confirmPicks();
      expect(game.player.replaceSpell).toHaveBeenCalledOnce();
      expect(game.player.replaceSpell.mock.calls[0][0]).toBe(1);
      expect(hud.showSpellsPicker).toBe(false);
      expect(hud.draftSpells).toEqual([]);
      expect(game.unpause).toHaveBeenCalled();
    });

    it('closeSpellPicker discards staged picks without applying them', () => {
      const game = fakeGame();
      const hud = openWithDraft(game);
      hud.pick(spell({ name: 'Bỏ Đi' }));
      hud.closeSpellPicker();
      expect(game.player.replaceSpell).not.toHaveBeenCalled();
      expect(hud.draftSpells).toEqual([]);
    });

    it('oneForAll stages into every slot and confirm replaces them all at once', () => {
      const game = fakeGame();
      const hud = openWithDraft(game);
      hud.oneForAll = true;
      hud.pick(spell({ name: 'Một Cho Tất Cả' }));
      expect(hud.draftSpells.every(s => s?.name === 'Một Cho Tất Cả')).toBe(true);
      hud.confirmPicks();
      expect(game.player.replaceSpells).toHaveBeenCalledOnce();
      expect(game.player.replaceSpell).not.toHaveBeenCalled();
    });

    /**
     * The bots come from `game.director.bots()`, and the respawn switch is a
     * method now, not a raw `_respawnWithNewPreset` field reached through
     * `any`. Both halves are asserted here because both changed shape at once.
     */
    it('clone my spells copies the pick to every bot and pins its respawn roll off', () => {
      const bot = fakeBot();
      const game = fakeGame([bot]);
      const hud = openWithDraft(game);
      hud.cloneMySpell = true;
      hud.spellIndexToSwap = 1;
      hud.pick(spell({ name: 'Nhân Bản' }));
      hud.confirmPicks();

      expect(bot.replaceSpell).toHaveBeenCalledOnce();
      expect(bot.replaceSpell.mock.calls[0][0]).toBe(1);
      expect(bot.setRespawnRollsNewPreset).toHaveBeenCalledWith(false);
    });

    /**
     * Without the clone, a bot keeps its own kit — and gets its roll armed, so
     * it comes back as a fresh champion rather than the one the player just
     * left it holding.
     */
    it('without the clone a bot is left alone but its respawn roll is armed', () => {
      const bot = fakeBot();
      const game = fakeGame([bot]);
      const hud = openWithDraft(game);
      hud.spellIndexToSwap = 1;
      hud.pick(spell({ name: 'Không Nhân Bản' }));
      hud.confirmPicks();

      expect(bot.replaceSpell).not.toHaveBeenCalled();
      expect(bot.setRespawnRollsNewPreset).toHaveBeenCalledWith(true);
    });

    it('one spell for all reaches the bots too, with the roll pinned off', () => {
      const bot = fakeBot();
      const game = fakeGame([bot]);
      const hud = openWithDraft(game);
      hud.oneForAll = true;
      hud.pick(spell({ name: 'Một Cho Tất Cả' }));
      hud.confirmPicks();

      expect(bot.replaceSpells).toHaveBeenCalledOnce();
      expect(bot.setRespawnRollsNewPreset).toHaveBeenCalledWith(false);
    });
  });
});
