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
 * `GameScene` now cancels only touches whose target is the game canvas. DOM
 * controls layered above it retain native click, input and scroll behavior.
 */
import { markRaw, reactive, toRaw } from 'vue';
import type Game from '@/game/Game';
import type { RenderFps } from '@/game/Game';
import type MatchDirector from '@/game/MatchDirector';
import type Camera from '@/game/gameObject/map/Camera';
import type { RenderQuality } from '@/game/managers/ObjectManager';
import { removeAccents } from '@/utils/index';
import type { AssetKey } from '@/managers/AssetManager';

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
  spellHover: any;
  spellInfo: { top: string; bottom: string; left: string; width: string };
  /** Mirrors game.touchControls.enabled; both views read it, neither owns it. */
  touchUi: boolean;
  /**
   * The qualified id of the map this match is actually running on —
   * `game.activeMapId`, fixed for the whole match. `MatchDirectorSource.getMap()`
   * reads this directly, the same way it reads `renderQuality`/`renderFps`
   * off this object rather than through `director`: a fact about the match,
   * not one of its mutable settings.
   */
  readonly activeMapId: string;
  readonly renderQuality: RenderQuality;
  readonly renderFps: RenderFps;
  setRenderQuality(quality: RenderQuality): void;
  setRenderFps(fps: RenderFps): void;
  /**
   * Apply a touch/pointer switch to the *running* match — the on-screen
   * controls and the HUD layout both. The config panel's Cài đặt tab is the
   * only caller: that control used to exist only on the pregame screen, so a
   * player who had already pressed Chơi could not reach it at all.
   *
   * It does not remember anything. The panel stores the tri-state
   * (`'auto' | 'touch' | 'pointer'`) through `setTouchModePreference` itself,
   * and the boolean this takes cannot express `'auto'` — so `remember` is
   * `false` here on purpose, or picking `Tự động` would be written back as
   * whichever side detection happened to resolve to.
   */
  setTouchUiEnabled(enabled: boolean): void;

  /**
   * Set by whichever component has a layer open *over* the panel — today only
   * `RosterTab`, while its loadout editor is up. Returns whether it consumed
   * the Escape. `null` when there is no inner layer, which is the usual case.
   *
   * It lives here rather than in the component because the key never reaches
   * the DOM: p5 binds `keydown` on `window` and `GameScene` routes it, so the
   * only thing the two ends share is this object.
   */
  onEscapeInner: (() => boolean) | null;

  /**
   * What Escape means now. Innermost layer first — the same "the backdrop
   * steps back one layer" rule the setup screen follows — then the panel:
   * closed opens it, open closes it the way the close button does.
   */
  escape(): void;
  /**
   * Leave the match. Calls `Game.onExitRequested`, which `GameScene` set to
   * its own `showScene(MenuScene)`: quitting is a scene transition, not a
   * mutation of the running match, so it is deliberately not a
   * `MatchDirector` method.
   */
  requestExit(): void;
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
   * Hồi Thành, from the desktop HUD's button.
   *
   * Nothing but a forward to `Game.recall()`, which owns both halves of it —
   * press to go home, press again to call the trip off. The `B` key, this
   * button and the on-canvas touch button are three ways into one action, and
   * a second copy of "is it already channelling?" in any of them is how they
   * would come to disagree. It does **not** pause: unlike every other control
   * on this object it is a move in the match, not a way into the panel.
   */
  recall(): void;
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
    onEscapeInner: null as (() => boolean) | null,
    spellHover: null as any,
    spellInfo: { top: 'auto', bottom: '0px', left: '0px', width: '300px' },
    touchUi: false,
    get activeMapId(): string {
      return game.activeMapId;
    },
    get renderQuality(): RenderQuality {
      return game.renderQuality;
    },
    get renderFps(): RenderFps {
      return game.renderFps;
    },
    setRenderQuality(quality: RenderQuality): void {
      game.setRenderQuality(quality);
    },
    setRenderFps(fps: RenderFps): void {
      game.setRenderFps(fps);
    },
    setTouchUiEnabled(enabled: boolean): void {
      // `remember: false` — see the interface comment. The panel owns the
      // stored tri-state; this only applies a resolved side to the live match.
      game.setTouchControlsEnabled(enabled, false);
    },

    escape(): void {
      // The innermost layer gets it first, and only it: closing a modal and
      // the panel under it on one keypress is the mis-hit this whole change
      // exists to design out.
      if (state.onEscapeInner?.()) return;
      if (state.showSpellsPicker) state.closeSpellPicker();
      else state.openSpellPicker();
    },

    requestExit(): void {
      // Closed first so the panel is not left standing over a scene that is
      // about to be torn down.
      state.showSpellsPicker = false;
      state.editPlayerSlot = null;
      game.onExitRequested?.();
    },

    /**
     * The corner button's entry point, in both modes. It does not toggle:
     * there is one way in and the panel carries its own close, so a second
     * press on a button that is hidden behind the panel cannot happen.
     */
    openSpellPicker(): void {
      state.editPlayerSlot = null;
      state.showSpellsPicker = true;
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
      game.pause();
      state.spellHover = null;
    },

    closeSpellPicker(): void {
      state.showSpellsPicker = false;
      state.editPlayerSlot = null;
      game.unpause();
    },

    /** See the interface: one line, on purpose. */
    recall(): void {
      game.recall();
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
