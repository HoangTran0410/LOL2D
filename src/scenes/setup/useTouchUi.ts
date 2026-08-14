import { ref, type Ref } from 'vue';
import { touchControlsPreference, rememberTouchControlsPreference } from '../../game/input/TouchControls';

const TOUCH_UI_CLASS = 'touch-ui';

export interface TouchUiController {
  isTouchUi: Ref<boolean>;
  toggle(): void;
}

/**
 * Mirrors `Game.applyTouchUiClass()`'s `body.touch-ui` flag for screens that
 * render before any `Game` exists — the menu and this pregame screen both
 * need to lay themselves out for a thumb or a mouse before there is a
 * `Game.touchControls` to ask.
 *
 * Same class, same persisted preference (`touchControlsPreference` /
 * `rememberTouchControlsPreference` from `game/input/TouchControls.ts` — read
 * and written here, never redefined: that module stays the one owner of the
 * `localStorage` key and the query-param/capability-detection fallback
 * chain). A preference set from either side is honoured by the other: toggle
 * it here, then start a match, and `Game`'s own `touchControlsPreference()`
 * read at construction time sees the same choice; toggle it mid-match and
 * `body` already carries `touch-ui` by the time a later visit to this screen
 * mounts, so that live value — not a stale re-read of the preference — is
 * what this reads first.
 *
 * A mode flag rather than a viewport breakpoint, same reasoning as
 * `Game.applyTouchUiClass`: a narrow desktop window still has a hover, a
 * keyboard and a precise pointer, and wants the pointer layout regardless of
 * width.
 */
export const useTouchUi = (): TouchUiController => {
  // Not `document.body.classList.contains(...) ?? touchControlsPreference()`:
  // `contains` returns a real `false`, never `null`/`undefined`, so `??`
  // would never fall through to the preference at all — every first-ever
  // visit (no Game has run yet to set the class) would read as pointer mode
  // regardless of `?touch=1`, capability detection, or a previously
  // remembered preference.
  const initial = document.body?.classList.contains(TOUCH_UI_CLASS)
    ? true
    : touchControlsPreference();
  const isTouchUi = ref(initial);
  document.body?.classList.toggle(TOUCH_UI_CLASS, initial);

  const toggle = (): void => {
    const next = !isTouchUi.value;
    isTouchUi.value = next;
    rememberTouchControlsPreference(next);
    document.body?.classList.toggle(TOUCH_UI_CLASS, next);
  };

  return { isTouchUi, toggle };
};
