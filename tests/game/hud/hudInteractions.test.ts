import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHudInteractions,
  filterSpells,
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

describe('practice range controls', () => {
  /**
   * The DOM half of "apply while dragging, save on release". That the *source*
   * honours `persist: false` is asserted behaviourally, against both
   * implementations, in `matchConfigSource.contract.test.ts`; what a behaviour
   * test cannot see is that the slider is wired to both events at all.
   */
  it('applies CDR live on input and commits on change', () => {
    const source = readFileSync('src/game/hud/config/MatchTab.vue', 'utf8');

    expect(source).toContain('@input="onCdrInput"');
    expect(source).toContain('@change="onCdrChange"');
    expect(source).toContain('setCdr(cdrValue(event), false)');
    expect(source).toContain('setCdr(cdrValue(event), true)');
  });

  it('lazy-loads below-fold catalogue art instead of decoding it all on modal open', () => {
    const roster = readFileSync('src/scenes/setup/KitRoster.vue', 'utf8');
    const icon = readFileSync('src/scenes/setup/SpellIcon.vue', 'utf8');

    expect(roster).toContain('loading="lazy"');
    expect(roster).toContain('<SpellIcon :display="item.entry.display" lazy />');
    expect(icon).toContain(":loading=\"lazy ? 'lazy' : 'eager'\"");
  });

  it('exposes persistent quality and FPS controls in the settings tab', () => {
    const source = readFileSync('src/game/hud/config/SettingsTab.vue', 'utf8');

    expect(source).toContain('id="practice-render-quality"');
    expect(source).toContain('id="practice-render-fps"');
    expect(source).toContain('source.setRenderQuality');
    expect(source).toContain('source.setRenderFps');
  });

  it('waits for a default reset and disables its button while kits are loading', () => {
    const source = readFileSync('src/game/hud/config/MatchTab.vue', 'utf8');

    expect(source).toContain('await source.resetToDefaults()');
    expect(source).toContain(':disabled="resetting"');
  });
});

describe('createHudInteractions — the ways into the practice panel', () => {
  const fakeGame = () =>
    ({
      player: { spells: [{}, {}] },
      objectManager: { objects: [] },
      renderQuality: 'auto',
      renderFps: 60,
      setRenderQuality: vi.fn(),
      setRenderFps: vi.fn(),
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

  it('does not build or expose an unused full spell catalogue', () => {
    const hud = createHudInteractions(fakeGame());

    expect('allSpells' in hud).toBe(false);
    expect('spellGroups' in hud).toBe(false);
    expect('preloadSpellIcons' in hud).toBe(false);
  });

  it('routes render preferences to the live game', () => {
    const game = fakeGame();
    const hud = createHudInteractions(game);

    expect((hud as any).setRenderQuality).toBeTypeOf('function');
    expect((hud as any).setRenderFps).toBeTypeOf('function');
    (hud as any).setRenderQuality('low');
    (hud as any).setRenderFps(30);

    expect(game.setRenderQuality).toHaveBeenCalledWith('low');
    expect(game.setRenderFps).toHaveBeenCalledWith(30);
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

/**
 * Hồi Thành has two surfaces now — the desktop button here and the on-canvas
 * touch button — and one action. `Game.recall()` already owns "start it, or
 * call the trip off"; neither surface is allowed a second copy of that rule.
 */
describe('createHudInteractions — Hồi Thành', () => {
  const fakeGame = () =>
    ({
      player: { spells: [{}, {}] },
      objectManager: { objects: [] },
      renderQuality: 'auto',
      renderFps: 60,
      setRenderQuality: vi.fn(),
      setRenderFps: vi.fn(),
      pause: vi.fn(),
      unpause: vi.fn(),
      recall: vi.fn(),
    }) as any;

  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards to Game.recall() rather than reaching for the spell itself', () => {
    const game = fakeGame();
    const hud = createHudInteractions(game);

    (hud as any).recall();
    (hud as any).recall();

    expect(game.recall).toHaveBeenCalledTimes(2);
  });

  it('does not pause the match the way the panel buttons do', () => {
    const game = fakeGame();
    createHudInteractions(game).recall();

    expect(game.pause).not.toHaveBeenCalled();
  });

  /**
   * `GameScene` cancels touches on the canvas, so a thumb never synthesises a
   * `click` — a control with only `@click` is perfect under a mouse and dead
   * under a finger. This is the one thing about the button no behaviour test
   * of `hudInteractions` can see.
   */
  it('the desktop button answers a thumb as well as a mouse, and shows its key', () => {
    const source = readFileSync('src/game/hud/DesktopHudView.vue', 'utf8');

    expect(source).toContain('class="recall-btn"');
    expect(source).toContain('@click="hud.recall()"');
    expect(source).toContain('@touchend.prevent="hud.recall()"');
    expect(source).toContain('state.recall.hotKey');
    expect(source).toContain('state.recall.progressPercent');
  });
});
