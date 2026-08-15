/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The other half of the shared layer: not display data but what a thumb or a
 * cursor *does* — opening the practice panel, hovering a description.
 *
 * One `HudInteractions` object is created once per game and `provide()`d to
 * the whole HUD Vue app, so `DesktopHudView`, `MobileHudView` and the practice
 * panel all read and mutate the same reactive state instead of three
 * independent copies that could drift — opening the panel from the corner
 * button has to be visible to the panel, which is a different component. See
 * `docs/ADDING_SPELLS.md` for the spell registration this drives.
 *
 * The spell-picking surface that used to live here — `draftSpells`, `pick`,
 * `confirmPicks`, the two mode flags and the icon long-press handlers — went
 * with the Chiêu thức tab. `RosterTab`'s loadout editor is a superset of it
 * (every unit, not just the player, and whole saved kits), so what is left
 * here is the way *in*: `openSpellPicker` for the corner button and
 * `openPlayerLoadout` for the desktop strip's per-slot shortcut.
 *
 * Touch has no `click`. `GameScene`'s p5 touch handlers call
 * `preventDefault()` on every touch on the page (needed so a drag across the
 * *canvas* does not scroll or pinch-zoom it), and a browser that has had
 * `preventDefault()` called anywhere in a touch gesture will not synthesise
 * the trailing `click` for that gesture — not just on the canvas, on anything.
 * That is a real, verified difference from a desktop click, not a guess: a
 * real touch dispatched at a HUD icon leaves `showSpellsPicker` false, while
 * the same coordinates dispatched as a mouse click open it. So nothing here
 * that has to work under a thumb is wired to `@click` alone — the actions are
 * driven from `touchend` directly, and `@click` stays only for the mouse.
 */
import { markRaw, reactive, toRaw } from 'vue';
import type Game from '../Game';
import type MatchDirector from '../MatchDirector';
import type Camera from '../gameObject/map/Camera';
import { removeAccents } from '../../utils/index';
import * as AllSpells from '../gameObject/spells/index';
import { SpellGroups } from '../preset';
import AssetManager, { type AssetKey } from '../../managers/AssetManager';

/**
 * Past this many CSS pixels of travel, a touch is a drag — most often a thumb
 * scrolling a long list (the practice panel's roster, the loadout editor's
 * shelves) — and its `touchend` must not also act on whichever control
 * happened to be under the finger when the gesture started.
 * Same order of magnitude as `TouchLayout.TAP_SLOP` on the canvas controls,
 * for the same reason: wider than the jitter a still thumb produces, narrower
 * than a deliberate movement.
 */
export const TAP_MOVE_TOLERANCE_PX = 16;

export interface SpellGroupDisplay {
  name: string;
  image: string;
  background: string;
  imageKey: AssetKey | null;
  backgroundKey: AssetKey | null;
  spells: SpellItemDisplay[];
}

export interface SpellItemDisplay {
  name: string;
  image: string;
  description: string;
  coolDown: number;
  manaCost: number;
  spellClass: any;
  assetKey: AssetKey | null;
}

/**
 * Case/accent-insensitive matching over a spell list, by name or description.
 *
 * A plain function of its inputs so the matching is testable without building
 * a whole `HudInteractions` (which needs a `Game`, `AssetManager`, the real
 * spell classes, ...). Nothing in the HUD renders a search box today — the
 * picker that would have grown one is gone, and the loadout editor searches
 * `pregameCatalog` instead — so this is a ready seam rather than a live path,
 * kept because it is the one piece of the picker that was never picker-shaped.
 */
export function filterSpells(spells: SpellItemDisplay[], searchText: string): SpellItemDisplay[] {
  const search = removeAccents(searchText.toLowerCase());
  if (search === '') return spells;
  return spells.filter(spell => {
    const name = removeAccents(spell.name.toLowerCase());
    const desc = removeAccents(spell.description.toLowerCase());
    return name.includes(search) || desc.includes(search);
  });
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function buildSpellGroup(group: any): SpellGroupDisplay {
  const spells: SpellItemDisplay[] = group.spells.map(buildSpellItem);
  return {
    name: group.name,
    image: group.image
      ? AssetManager.get(group.image).url
      : AssetManager.placeholder(group.name).url,
    background: group.background ? AssetManager.get(group.background).url : '',
    imageKey: group.image,
    backgroundKey: group.background,
    spells,
  };
}

function buildSpellItem(SpellClass: any): SpellItemDisplay {
  const spellInstance = new SpellClass(null);
  return {
    name: spellInstance.name,
    image: spellInstance.image?.path,
    description: spellInstance.description,
    coolDown: spellInstance.coolDown,
    manaCost: spellInstance.manaCost,
    spellClass: SpellClass,
    assetKey: spellInstance.image?.key ?? null,
  };
}

export interface HudInteractions {
  /**
   * Every mutation of the running match — roster, world, rules — so the panel's
   * tabs never reach into `objectManager` or `minionSpawner` themselves. Read
   * off `game` on access rather than captured: `Game` builds its `InGameHUD`
   * (and so this object) part-way through its own constructor, before
   * `game.director` exists.
   */
  readonly director: MatchDirector;
  /**
   * The live camera, for the zoom slider. Same lazy `markRaw` shape as
   * `director` and for the same two reasons: the HUD is built part-way through
   * `Game`'s constructor, and a `reactive()` camera would hand back proxied p5
   * vectors on every read, every frame.
   */
  readonly camera: Camera;
  /**
   * Whether the practice panel is up. Keeps the `SpellsPicker` name it was
   * born with: it is read by all three e2e scripts off
   * `game.inGameHUD.vueInstance.hud`, and renaming it would reach into every
   * one of them for no behaviour.
   */
  showSpellsPicker: boolean;
  /**
   * Which of the player's slots the panel should open the loadout editor on,
   * or `null` for "just open the panel". Set by the desktop strip's per-icon
   * shortcut (`openPlayerLoadout`) and consumed once, on mount, by
   * `RosterTab` — the gesture crosses two components that never meet, so it
   * travels through the object both of them already inject.
   */
  editPlayerSlot: number | null;
  /** Every spell icon there is, for the preload below. */
  allSpells: SpellItemDisplay[];
  spellGroups: SpellGroupDisplay[];
  spellHover: any;
  spellInfo: { top: string; bottom: string; left: string; width: string };
  /** Mirrors game.touchControls.enabled; both views read it, neither owns it. */
  touchUi: boolean;

  /**
   * Opens the panel with no slot in mind — the corner button's entry point,
   * in both modes.
   */
  openSpellPicker(): void;
  /**
   * The desktop strip's shortcut: open the panel on Đấu thủ with the player's
   * loadout editor already open, aimed at the slot whose icon was clicked.
   * The gesture the old picker's `changeSpell(index)` had, pointed at the
   * editor that replaced it.
   */
  openPlayerLoadout(index: number): void;
  closeSpellPicker(): void;
  /**
   * Warms every spell icon's asset when the panel opens. Still worth doing
   * with the picker gone: `RosterTab`'s loadout editor (`KitRoster`) renders
   * the same roster from the same `AssetManager` keys, one tap further in.
   */
  preloadSpellIcons(): void;

  mouseover(spellProxy: any, event: any): void;
  mouseout(spellProxy: any): void;
  showSpellInfo(spellProxy: any, element: any): void;
  showPreview(spellProxy: any, show: boolean): void;
}

/**
 * `game` and everything reachable from it (`player`, `objectManager`, spell
 * instances) is a plain, un-proxied reference here — it arrives by closure,
 * never passed through Vue's `data()` — so none of *that* needs unwrapping.
 * The one exception is `spellProxy.instance` in `showPreview`: that object
 * comes from `HudState.spells`, which the view layers *do* receive through
 * reactive `data()`, so it is Vue-proxied by the time it reaches here.
 */
export function createHudInteractions(game: Game): HudInteractions {
  let director: MatchDirector | null = null;
  let camera: Camera | null = null;

  const state = reactive({
    /**
     * Resolved on first read, not here: `Game` constructs its `InGameHUD` —
     * which is what calls this factory — some 60 lines before it assigns
     * `this.director`, so a value captured at this point would be `undefined`
     * for the rest of the match.
     *
     * `markRaw` because everything below is inside a `reactive()`, and Vue
     * deep-proxies any object a reactive getter returns. A proxied director
     * would hand back a proxied `objectManager`, proxied units, proxied
     * position vectors — the whole game graph — on every roster read. See this
     * function's own doc comment: `game` is deliberately un-proxied here.
     */
    get director(): MatchDirector {
      if (!director && game.director) director = markRaw(game.director);
      return director as MatchDirector;
    },
    /** Same lazy `markRaw` getter as `director` above, for the same reasons. */
    get camera(): Camera {
      if (!camera && game.camera) camera = markRaw(game.camera);
      return camera as Camera;
    },
    showSpellsPicker: false,
    editPlayerSlot: null as number | null,
    allSpells: Object.values<any>(AllSpells).map(buildSpellItem),
    spellGroups: (SpellGroups as any[]).map(buildSpellGroup),
    spellHover: null as any,
    spellInfo: { top: 'auto', bottom: '0px', left: '0px', width: '300px' },
    touchUi: false,

    /**
     * The corner button's entry point, in both modes. It does not toggle:
     * there is one way in and the panel carries its own close, so a second
     * press on a button that is hidden behind the panel cannot happen.
     */
    openSpellPicker(): void {
      state.editPlayerSlot = null;
      state.showSpellsPicker = true;
      state.preloadSpellIcons();
      game.pause();
      state.spellHover = null;
    },

    /**
     * The desktop strip's per-icon shortcut. It used to open the picker
     * pre-aimed at the clicked slot; it now opens the panel on Đấu thủ with
     * the player's loadout editor open on that slot, which is the same
     * gesture pointed at the editor that replaced the picker. `RosterTab`
     * reads `editPlayerSlot` once on mount and clears it.
     */
    openPlayerLoadout(index: number): void {
      state.editPlayerSlot = index;
      state.showSpellsPicker = true;
      state.preloadSpellIcons();
      game.pause();
      state.spellHover = null;
    },

    preloadSpellIcons(): void {
      const keys = new Set<AssetKey>();
      const add = (key: AssetKey | null) => {
        if (key) keys.add(key);
      };
      for (const spell of state.allSpells) add(spell.assetKey);
      for (const group of state.spellGroups) {
        add(group.imageKey);
        add(group.backgroundKey);
        for (const spell of group.spells) add(spell.assetKey);
      }
      void AssetManager.ensureMany([...keys]).catch(error => console.warn(error));
    },

    closeSpellPicker(): void {
      state.showSpellsPicker = false;
      state.editPlayerSlot = null;
      game.unpause();
    },

    mouseover(spellProxy: any, event: any): void {
      // Hover is a mouse gesture. On a touch screen the browser fires one
      // anyway on the way to a click, which would flash the description for
      // an instant every time a player opened the picker.
      if (state.touchUi) return;
      state.showPreview(spellProxy, true);
      state.showSpellInfo(spellProxy, event.currentTarget || event.target);
    },

    /**
     * Place the description panel next to `element`.
     *
     * Above it with a mouse, because the spell bar is along the bottom of the
     * screen. Below it under a thumb, because in touch mode the bar used to
     * be at the top and "above" would have been off the screen entirely —
     * the bar is gone now (see `MobileHudView.vue`), but the picker's own
     * roster this is reached from is still anchored near the top of a
     * viewport-filling modal, so the reasoning still holds. The panel also
     * stops being a fixed 300px there — that is most of a phone held sideways
     * — and is kept inside the viewport on all four edges, not just the two
     * sides: an icon long-pressed near the top of the picker's roster (the
     * basic attack, first in the list, is the easy way to hit this) used to
     * push the panel's bottom edge past the bottom of the screen, because
     * only `left` was ever clamped. Caught by retargeting
     * `drive-touch-controls.mjs`'s long-press check from the strip (always
     * near the very top, so "below" always had the whole screen to work
     * with) to a picker roster icon after the strip came out — a case that
     * was always reachable, just never exercised.
     */
    showSpellInfo(spellProxy: any, element: any): void {
      if (!element?.getBoundingClientRect) return;
      state.spellHover = spellProxy;
      const { width, x, y, bottom } = element.getBoundingClientRect();

      if (!state.touchUi) {
        state.spellInfo = {
          top: 'auto',
          bottom: 'calc(100vh - ' + (y - 5) + 'px)',
          left: Math.max(x + width / 2 - 150, 0) + 'px',
          width: '300px',
        };
        return;
      }

      const panelWidth = Math.min(300, window.innerWidth * 0.78);
      const left = Math.min(
        Math.max(x + width / 2 - panelWidth / 2, 6),
        Math.max(6, window.innerWidth - panelWidth - 6)
      );
      // Matches body.touch-ui .spell-info's `max-height: 60vh` in
      // styles/hud.css — the panel scrolls its own overflow past that, but
      // nothing stopped its *top* from landing so low the whole box, or most
      // of it, sat below the viewport.
      const maxPanelHeight = window.innerHeight * 0.6;
      const top = Math.min(bottom + 8, Math.max(6, window.innerHeight - maxPanelHeight - 6));
      state.spellInfo = {
        top: top + 'px',
        bottom: 'auto',
        left: left + 'px',
        width: panelWidth + 'px',
      };
    },

    mouseout(spellProxy: any): void {
      if (state.touchUi) return;
      state.showPreview(spellProxy, false);
      state.spellHover = null;
    },

    showPreview(spellProxy: any, show: boolean): void {
      try {
        const s = toRaw(spellProxy.instance);
        if (s) s.willDrawPreview = show || false;
      } catch (e) {
        console.error(e);
      }
    },
  }) as unknown as HudInteractions;

  return state;
}
