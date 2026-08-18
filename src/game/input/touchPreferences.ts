import type { AttackTargetPriority } from '@/game/combat/AttackTargeting';

/**
 * The three touch settings, and nothing that draws.
 *
 * Split out of `TouchControls.ts` for one reason: the pregame **Settings tab**
 * reads and writes them, and that file is the 27KB on-screen controller — the
 * joystick, the ability ring, the aim resolution, `SpellAim`, `VirtualJoystick`.
 * Vite's `manualChunks` sends anything under `src/game/` to the `game` chunk, so
 * a settings panel asking "is touch mode on?" pulled the entire match with it.
 *
 * Everything here is `localStorage` and capability detection: no p5 globals, no
 * game objects, safe to import from the menu or the setup screen. `TouchControls`
 * re-exports the lot, so every existing
 * `from '@/game/input/TouchControls'` still resolves.
 */

const STORAGE_KEY = 'lol2d.touchControls';
const TARGET_PRIORITY_STORAGE_KEY = 'lol2d.touchTargetPriority';

export type TouchTargetPriority = AttackTargetPriority;

export function touchTargetPriorityPreference(): TouchTargetPriority {
  try {
    return window.localStorage.getItem(TARGET_PRIORITY_STORAGE_KEY) === 'lowest-health'
      ? 'lowest-health'
      : 'nearest';
  } catch {
    return 'nearest';
  }
}

export function setTouchTargetPriorityPreference(priority: TouchTargetPriority): void {
  try {
    window.localStorage.setItem(TARGET_PRIORITY_STORAGE_KEY, priority);
  } catch {
    /* storage blocked: the default remains playable */
  }
}

/**
 * The player's stored choice: run capability detection, or force one side.
 * Lives in the pregame setup screen's Settings tab (a global preference,
 * not an in-game control — see `InGameHUD.vue`'s file comment for why the
 * old in-game toggle came out). `'auto'` is the default and the only value
 * that consults `detectTouchCapability` at all.
 */
export type TouchModePreference = 'auto' | 'touch' | 'pointer';

function detectTouchCapability(): boolean {
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  return typeof window !== 'undefined' && 'ontouchstart' in window;
}

/**
 * The raw stored preference — what the Settings tab shows and writes.
 *
 * Reads (and silently upgrades on write) a legacy `'1'`/`'0'`: that was the
 * old binary toggle's storage format, and without this migration a player
 * who had picked touch mode before this tri-state existed would read back
 * as `'auto'`, quietly losing an explicit choice they made. `'auto'` is the
 * fallback for everything else — missing key, blocked storage, or a value
 * that is none of the above.
 */
export function touchModePreference(): TouchModePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'auto' || stored === 'touch' || stored === 'pointer') return stored;
    if (stored === '1') return 'touch';
    if (stored === '0') return 'pointer';
  } catch {
    /* storage blocked: default to auto */
  }
  return 'auto';
}

/** What the Settings tab calls when the player picks a mode. */
export function setTouchModePreference(preference: TouchModePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* storage blocked: the setting still works for this session */
  }
}

/**
 * Whether the controls start on — the resolved, binary answer everything
 * except the Settings tab itself should read.
 *
 * Three sources, most explicit first. The query parameter is what makes the
 * whole thing verifiable: Playwright drives a desktop Chrome, and without an
 * override there would be no way to reach these controls from a test at
 * all — this resolves ahead of the stored preference and stays independent
 * of it, so it keeps working with no UI control wired to it at all. The
 * stored preference is next, and only its `'auto'` value (the default) falls
 * through to capability detection, the right default for a real phone that
 * has never been near the Settings tab.
 */
export function touchControlsPreference(): boolean {
  try {
    const query = new URLSearchParams(window.location.search).get('touch');
    if (query === '1' || query === 'true' || query === 'on') return true;
    if (query === '0' || query === 'false' || query === 'off') return false;
  } catch {
    /* no location: fall through to the stored preference */
  }
  const preference = touchModePreference();
  if (preference === 'touch') return true;
  if (preference === 'pointer') return false;
  return detectTouchCapability();
}

/**
 * Kept so `Game.setTouchControlsEnabled`'s existing `remember` path did not
 * have to change alongside this file: a thin wrapper over
 * `setTouchModePreference`, still storing a resolved on/off rather than
 * `'auto'` — this is reached by an explicit choice (an on-screen control
 * setting `enabled` one way or the other), never by detection, so there is
 * no `'auto'` to preserve here.
 */
export function rememberTouchControlsPreference(enabled: boolean): void {
  setTouchModePreference(enabled ? 'touch' : 'pointer');
}
