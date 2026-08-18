import { ref, type CSSProperties, type Ref } from 'vue';
import type { SpellDisplay } from '@/game/config/spellCatalog';

/**
 * "What does this spell do?" for a roster where tapping an icon *equips* it.
 *
 * The pregame picker's icons have one job — put this spell in the selected
 * slot — which is the whole reason the old screen's two competing click
 * targets are gone. It used to be that tapping the icon opened a
 * description and tapping just beside it opened a picker, with no way to
 * tell from looking which you would get; every attempt to fix that added
 * another visible control. Reading the description is a *second gesture* on
 * the same icon now, not a second target beside it: hover with a mouse, hold
 * with a thumb. Same contract as the in-game HUD picker
 * (`hudInteractions.ts`), so the two screens answer the question the same
 * way.
 *
 * Unlike the in-game one, nothing here fights the canvas: the pregame screen
 * is a plain DOM overlay with no `preventDefault()` on touch, so `click`
 * fires normally under a thumb and staging a spell stays wired to `@click`.
 * The one consequence of that is `touchEnd`'s return value — see below.
 *
 * ## Closing it is the second half of opening it
 *
 * A hover closes itself; a hold does not, and for a while nothing else did
 * either — see `heldOpen`. The composable answers "is this panel waiting on a
 * deliberate dismissal?" and the caller renders the layer that provides one
 * (`.spell-peek-scrim` in `LoadoutEditorModal.vue`). The panel itself stays
 * `pointer-events: none` in both modes: it is a description, never a target.
 */

/** How long a thumb rests before the description opens. Matches `LONG_PRESS_MS` in `hudInteractions.ts`. */
export const PEEK_LONG_PRESS_MS = 400;

/** Past this much travel the gesture is a scroll, not a hold. Matches `TAP_MOVE_TOLERANCE_PX`. */
const TAP_MOVE_TOLERANCE_PX = 16;

/** Bound straight to a `:style`, so it has to satisfy Vue's own `StyleValue`. */
export type PeekStyle = CSSProperties & {
  top: string;
  bottom: string;
  left: string;
  width: string;
  maxHeight: string;
};

export interface SpellPeek {
  display: Ref<SpellDisplay | null>;
  style: Ref<PeekStyle>;
  /**
   * True while the panel on screen was opened by a hold rather than a hover.
   * A hover ends itself — the cursor moves off the icon and `mouseleave`
   * closes it. A hold has no such end, so the caller renders a dismiss layer
   * over the screen for exactly as long as this is true, and *that* is what
   * takes the panel down. This used to be a 3-second timer instead, which was
   * both too short to read a description and too fragile to rely on: it was
   * armed from the `click` the browser synthesises after a hold, and a hold
   * that raises the platform's own image/context menu synthesises no click at
   * all, leaving the panel up with nothing able to close it.
   */
  heldOpen: Ref<boolean>;
  hoverStart(display: SpellDisplay, event: MouseEvent): void;
  hoverEnd(): void;
  touchStart(display: SpellDisplay, event: TouchEvent): void;
  touchMove(event: TouchEvent): void;
  /**
   * Ends a touch. Returns `true` when the hold opened a description, meaning
   * the browser's synthesised `click` is about to arrive for a gesture the
   * player did not intend as a tap — the caller drops that one click. (The
   * in-game picker has the opposite problem: there, `preventDefault()` on the
   * canvas means no `click` is synthesised at all.)
   *
   * Call it from `touchend` *and* from the click handler: the click is the
   * one that has to be dropped, but it is also the one that may never come.
   * Both paths are idempotent.
   */
  touchEnd(): boolean;
  close(): void;
}

/** Keeps the panel on screen: below the icon when it fits, above it otherwise, never past a side edge. */
const place = (element: HTMLElement): PeekStyle => {
  const { x, y, width, bottom } = element.getBoundingClientRect();
  const panelWidth = Math.min(320, window.innerWidth - 12);
  const left = Math.min(
    Math.max(x + width / 2 - panelWidth / 2, 6),
    Math.max(6, window.innerWidth - panelWidth - 6)
  );
  const maxHeight = Math.round(window.innerHeight * 0.5);
  const fitsBelow = bottom + 8 + maxHeight <= window.innerHeight - 6;

  return {
    top: fitsBelow ? `${bottom + 8}px` : 'auto',
    // Anchoring the *bottom* edge to the icon (rather than computing a top
    // from the max height) keeps a short description tucked against the icon
    // it describes instead of floating half a screen above it.
    bottom: fitsBelow ? 'auto' : `${Math.max(6, window.innerHeight - y + 8)}px`,
    left: `${left}px`,
    width: `${panelWidth}px`,
    maxHeight: `${maxHeight}px`,
  };
};

export const useSpellPeek = (): SpellPeek => {
  const display = ref<SpellDisplay | null>(null);
  const heldOpen = ref(false);
  const style = ref<PeekStyle>({
    top: 'auto',
    bottom: 'auto',
    left: '0px',
    width: '320px',
    maxHeight: '50vh',
  });

  let longPressTimer = 0;
  let longPressFired = false;
  let startX = 0;
  let startY = 0;
  let moved = false;

  const clearTimers = (): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  };

  const open = (next: SpellDisplay, element: HTMLElement): void => {
    style.value = place(element);
    display.value = next;
  };

  const close = (): void => {
    clearTimers();
    display.value = null;
    heldOpen.value = false;
    // Cleared with the panel, not left standing until the next `touchstart`:
    // otherwise the first plain click after a dismissed hold reads as that
    // hold's leftover click and gets dropped.
    longPressFired = false;
  };

  return {
    display,
    style,
    heldOpen,

    hoverStart(next, event): void {
      const element = (event.currentTarget ?? event.target) as HTMLElement | null;
      if (element?.getBoundingClientRect) open(next, element);
    },

    hoverEnd(): void {
      // Only a mouse gets here (touch never fires `mouseleave` reliably), and
      // a mouse has somewhere to move to — so this closes immediately rather
      // than waiting out `PEEK_DISMISS_MS` like the touch path does.
      close();
    },

    touchStart(next, event): void {
      const element = (event.currentTarget ?? event.target) as HTMLElement | null;
      // Belt and braces for a panel that somehow outlived its gesture. In the
      // normal run this never fires: a held-open description has the dismiss
      // layer over it, so this `touchstart` would have landed there instead.
      // It only matters on a device that swallowed the `touchend` — the shape
      // of the bug this whole path exists to answer — where it keeps a stale
      // description from following the player down the roster.
      if (display.value) close();
      clearTimers();
      longPressFired = false;
      moved = false;
      const touch = event.touches[0];
      startX = touch?.clientX ?? 0;
      startY = touch?.clientY ?? 0;
      if (!element?.getBoundingClientRect) return;
      longPressTimer = window.setTimeout(() => {
        longPressFired = true;
        open(next, element);
      }, PEEK_LONG_PRESS_MS);
    },

    touchMove(event): void {
      if (moved) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) <= TAP_MOVE_TOLERANCE_PX)
        return;
      moved = true;
      // A finger on its way somewhere (scrolling the roster) must not leave a
      // description behind it.
      clearTimers();
    },

    touchEnd(): boolean {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
      if (!longPressFired) return false;
      // The thumb is off the icon and the description is staying: hand it its
      // dismiss layer. Set here rather than in `open()` so it never covers the
      // screen while the finger that opened it is still down.
      heldOpen.value = true;
      return true;
    },

    close,
  };
};
