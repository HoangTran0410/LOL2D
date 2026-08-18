import { ref, type Ref } from 'vue';
import {
  touchControlsPreference,
  touchModePreference,
  setTouchModePreference,
  type TouchModePreference,
} from '@/game/input/touchPreferences';

const TOUCH_UI_CLASS = 'touch-ui';

export interface TouchUiController {
  /** The resolved layout: what the screen actually renders as. */
  isTouchUi: Ref<boolean>;
  /**
   * The stored *choice*, which is a different question from the resolved
   * layout: `'auto'` on a phone and `'touch'` on a phone both render the same
   * way, and the Settings row has to show which of the two the player picked.
   */
  mode: Ref<TouchModePreference>;
  toggle(): void;
  /**
   * Sets the mode explicitly rather than flipping it — what the Settings
   * tab's three-option row needs (`SettingsTab.vue`'s "Chạm tay" / "Chuột &
   * bàn phím" buttons each pick a specific side, not toggle relative to
   * whatever the current side happens to be). `toggle()` is kept as a thin
   * wrapper over this for anything that only ever flips.
   */
  set(value: boolean): void;
  /**
   * Picks one of the three stored states. `'auto'` hands the decision back to
   * capability detection — the only way out of a manual override, and the
   * reason this is a tri-state rather than a switch.
   */
  setMode(preference: TouchModePreference): void;
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
  const mode = ref<TouchModePreference>(touchModePreference());
  document.body?.classList.toggle(TOUCH_UI_CLASS, initial);

  const setMode = (preference: TouchModePreference): void => {
    setTouchModePreference(preference);
    mode.value = preference;
    // Re-resolve rather than assume: picking `'auto'` means "whatever this
    // device is", which only `touchControlsPreference()` knows — and it also
    // still honours a `?touch=` override, so the layout never contradicts the
    // query parameter the e2e harness drives this screen with.
    const resolved = touchControlsPreference();
    isTouchUi.value = resolved;
    document.body?.classList.toggle(TOUCH_UI_CLASS, resolved);
  };

  const set = (value: boolean): void => setMode(value ? 'touch' : 'pointer');
  const toggle = (): void => set(!isTouchUi.value);

  return { isTouchUi, mode, toggle, set, setMode };
};
