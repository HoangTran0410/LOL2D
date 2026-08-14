/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The other half of the shared layer: not display data but what a thumb or a
 * cursor *does* — picking a spell, hovering a description, holding a finger
 * down long enough to ask what an icon means.
 *
 * One `HudInteractions` object is created once per game and `provide()`d to
 * the whole HUD Vue app, so `DesktopHudView`, `MobileHudView` and
 * `SpellPickerModal` all read and mutate the same reactive state instead of
 * three independent copies that could drift — opening the picker from the
 * mobile strip has to be visible to the modal, which is a different
 * component. See `docs/ADDING_SPELLS.md` for the spell registration this
 * drives.
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
import { reactive, toRaw } from 'vue';
import type Game from '../Game';
import AIChampion from '../gameObject/attackableUnits/AIChampion';
import { removeAccents } from '../../utils/index';
import * as AllSpells from '../gameObject/spells/index';
import { SpellGroups } from '../preset';
import AssetManager, { type AssetKey } from '../../managers/AssetManager';

/**
 * How long a thumb must rest on a spell icon before its description appears.
 *
 * The tooltip is opened by hover on the desktop, and a touch screen has no
 * hover — which left the only place in the game that says what an ability does
 * unreachable on the device where a player is least likely to know already.
 * 400ms is the usual long-press: past a tap, short of feeling stuck.
 */
export const LONG_PRESS_MS = 400;

/** How long the description stays up after the thumb lifts. */
export const LONG_PRESS_DISMISS_MS = 2500;

/**
 * Past this many CSS pixels of travel, a touch is a drag — most often a thumb
 * scrolling the spell picker's list — and its `touchend` must not also pick
 * whichever icon happened to be under the finger when the gesture started.
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
 * Pulled out as a plain function of its inputs so the search matching itself
 * — case/accent-insensitive, name or description — is testable without
 * building a whole `HudInteractions` (which needs a `Game`, `AssetManager`,
 * the real spell classes, ...).
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
  oneForAll: boolean;
  cloneMySpell: boolean;
  /**
   * `searchSpellText`/`filteredSpells()` are carried over from the
   * pre-split `InGameHUD` unchanged — including that neither view renders a
   * search box, there or here. Kept (and unit-tested, see
   * `filterSpells` below) as a ready seam for one, not wired up now: a
   * search box for the picker is a real improvement as the roster grows, but
   * it is not one of the four things this pass was asked to fix, and this
   * split's job is not to grow the feature list.
   */
  searchSpellText: string;
  showSpellsPicker: boolean;
  spellIndexToSwap: number;
  /**
   * The staged loadout, one entry per equipped slot, parallel to
   * `HudState.spells`. `null` means "this slot is unchanged from what the
   * player has equipped"; a `SpellItemDisplay` is a pending pick not yet
   * applied to the game. Picking edits this; `confirmPicks` flushes it to the
   * real champion and `closeSpellPicker` throws it away — the point of the
   * whole draft is that a player can try several spells before committing,
   * instead of every tap applying and closing the modal. See `pick`.
   */
  draftSpells: (SpellItemDisplay | null)[];
  /** Used for pre-loading every spell icon's asset before the picker opens. */
  allSpells: SpellItemDisplay[];
  spellGroups: SpellGroupDisplay[];
  spellHover: any;
  spellInfo: { top: string; bottom: string; left: string; width: string };
  /** Mirrors game.touchControls.enabled; both views read it, neither owns it. */
  touchUi: boolean;

  filteredSpells(): SpellItemDisplay[];
  /** Stages `spell` into the active slot (or every slot, under `oneForAll`). Does not apply or close — see `draftSpells`. */
  pick(spell: SpellItemDisplay): void;
  /** Flushes the staged `draftSpells` to the player (and bots, per the two mode flags), then closes the picker. */
  confirmPicks(): void;
  changeSpell(index: number): void;
  /**
   * Opens the picker without a specific icon having been tapped to reach it
   * — the mobile corner button's entry point, now that the bottom-HUD strip
   * (and its per-slot tap targets) no longer exists in touch mode.
   */
  openSpellPicker(): void;
  closeSpellPicker(): void;
  loadSpellPickerAssets(): void;

  /** Armed by a touch landing on a spell icon; fires the description on a hold. */
  touchSpellStart(spellProxy: any, event: any): void;
  /** A finger moving while down on a spell icon — arms the drag-not-tap escape. */
  touchSpellMove(event: any): void;
  /**
   * A touch lifted off a spell icon. `onTap` is what a `click` would have
   * done — passed in rather than assumed, because the strip wants
   * `changeSpell` and the picker's own list wants `pick`. Runs only when the
   * long press never fired and the finger never travelled past
   * `TAP_MOVE_TOLERANCE_PX` — the second guard is what a synthesised click
   * gets for free from the browser's own click-vs-drag heuristic, and has to
   * be done by hand here since nothing here is wired to `click`.
   */
  touchSpellEnd(onTap?: () => void): void;
  cancelLongPress(): void;

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
  let longPressTimer = 0;
  let longPressDismissTimer = 0;
  let longPressFired = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;

  const state = reactive({
    oneForAll: false,
    cloneMySpell: false,
    searchSpellText: '',
    showSpellsPicker: false,
    spellIndexToSwap: 0,
    allSpells: Object.values<any>(AllSpells).map(buildSpellItem),
    spellGroups: (SpellGroups as any[]).map((group: any) => ({
      name: group.name,
      image: group.image
        ? AssetManager.get(group.image).url
        : AssetManager.placeholder(group.name).url,
      background: group.background ? AssetManager.get(group.background).url : '',
      imageKey: group.image,
      backgroundKey: group.background,
      spells: group.spells.map(buildSpellItem),
    })),
    draftSpells: [] as (SpellItemDisplay | null)[],
    spellHover: null as any,
    spellInfo: { top: 'auto', bottom: '0px', left: '0px', width: '300px' },
    touchUi: false,

    filteredSpells(): SpellItemDisplay[] {
      return filterSpells(state.allSpells, state.searchSpellText);
    },

    /**
     * Stage a pick into `draftSpells` — nothing touches the game until
     * `confirmPicks`. `oneForAll` fills every slot so the slot-picker previews
     * the "one spell everywhere" effect; otherwise only the active slot
     * changes. The player can keep re-picking any slot until they are happy,
     * then commit the lot at once, which is the whole point of the draft (the
     * old behaviour applied and closed on the first tap).
     */
    pick(spell: SpellItemDisplay): void {
      if (state.oneForAll) {
        state.draftSpells = state.draftSpells.map(() => spell);
      } else if (state.spellIndexToSwap >= 0 && state.spellIndexToSwap < state.draftSpells.length) {
        const next = state.draftSpells.slice();
        next[state.spellIndexToSwap] = spell;
        state.draftSpells = next;
      }
      state.spellHover = null;
    },

    /**
     * Apply the whole staged draft in one go, then close. The per-slot and the
     * `oneForAll` branches mirror what `pick` used to do immediately; the bot
     * handling (`cloneMySpell` vs. the respawn flag) is unchanged, just run
     * once per changed slot at commit time instead of on every tap.
     */
    confirmPicks(): void {
      const player = (game as any).player;
      const bots = game.objectManager.objects.filter((o: any) => o instanceof AIChampion);

      if (state.oneForAll) {
        const chosen = state.draftSpells.find(Boolean);
        if (chosen) {
          player.replaceSpells(player.spells.map(() => new chosen.spellClass(player)));
          bots.forEach((bot: any) => {
            bot._respawnWithNewPreset = false;
            bot.replaceSpells(bot.spells.map(() => new chosen.spellClass(bot)));
          });
        }
      } else {
        state.draftSpells.forEach((item, index) => {
          if (!item || index < 0 || index > player.spells.length) return;
          player.replaceSpell(index, new item.spellClass(player));
          bots.forEach((bot: any) => {
            if (state.cloneMySpell) {
              bot._respawnWithNewPreset = false;
              bot.replaceSpell(index, new item.spellClass(bot));
            } else {
              bot._respawnWithNewPreset = true;
            }
          });
        });
      }

      state.showSpellsPicker = false;
      game.unpause();
      state.spellHover = null;
      state.draftSpells = [];
    },

    touchSpellStart(spellProxy: any, event: any): void {
      const element = event.currentTarget || event.target;
      state.cancelLongPress();
      longPressFired = false;
      touchMoved = false;
      const touch = event.touches?.[0];
      touchStartX = touch?.clientX ?? 0;
      touchStartY = touch?.clientY ?? 0;
      longPressTimer = window.setTimeout(() => {
        longPressFired = true;
        state.showSpellInfo(spellProxy, element);
      }, LONG_PRESS_MS);
    },

    touchSpellMove(event: any): void {
      if (touchMoved) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const travelled = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
      if (travelled <= TAP_MOVE_TOLERANCE_PX) return;
      touchMoved = true;
      // Past this point the gesture is a drag (most often scrolling the
      // picker's list), not a hold — the description must not pop up under a
      // finger that is on its way somewhere else.
      state.cancelLongPress();
    },

    touchSpellEnd(onTap?: () => void): void {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
      if (longPressFired) {
        // Nothing to hover away from on a touch screen, so the description
        // times itself out rather than waiting for a gesture nobody will make.
        longPressDismissTimer = window.setTimeout(() => {
          state.spellHover = null;
        }, LONG_PRESS_DISMISS_MS);
        return;
      }
      // A drag that started on an icon (typically scrolling the picker) must
      // not also pick or swap that icon on release.
      if (touchMoved) return;
      onTap?.();
    },

    cancelLongPress(): void {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
      if (longPressDismissTimer) {
        clearTimeout(longPressDismissTimer);
        longPressDismissTimer = 0;
      }
    },

    changeSpell(index: number): void {
      state.spellIndexToSwap = index;
      state.showSpellsPicker = !state.showSpellsPicker;

      if (state.showSpellsPicker) {
        state.draftSpells = Array.from(
          { length: (game as any).player?.spells?.length ?? 0 },
          () => null
        );
        state.loadSpellPickerAssets();
        game.pause();
      } else game.unpause();

      state.spellHover = null;
    },

    /**
     * The mobile corner button's entry point: unlike `changeSpell`, it does
     * not toggle (there is only one way in, so there is nothing to toggle
     * against) and it does not arrive already knowing which slot the player
     * wants — the strip used to answer that by which icon was tapped, and
     * that per-icon surface is exactly what got removed. Defaults to the
     * first ability; `SpellPickerModal`'s slot selector (touch-ui only) lets
     * the player switch to any other slot, including the basic attack and
     * the summoners, without leaving the modal.
     */
    openSpellPicker(): void {
      state.spellIndexToSwap = 1;
      state.showSpellsPicker = true;
      state.draftSpells = Array.from(
        { length: (game as any).player?.spells?.length ?? 0 },
        () => null
      );
      state.loadSpellPickerAssets();
      game.pause();
      state.spellHover = null;
    },

    loadSpellPickerAssets(): void {
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
      game.unpause();
      state.draftSpells = [];
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
