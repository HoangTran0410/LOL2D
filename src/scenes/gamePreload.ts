import { assetManifest, type AssetKey } from '@/generated/assetManifest';
import AssetManager from '@/managers/AssetManager';
import type GameScene from './GameScene';
import type SetupScene from './SetupScene';

/**
 * The menu's warm-up: the game's code and the art a match draws, fetched while
 * the player is looking at the main menu instead of after they press Chơi.
 *
 * Two separate wins, and they are worth naming separately because they are
 * fixed by different halves of this file:
 *
 * - **Code.** `MenuScene` used to `import GameScene` and `SetupScene`
 *   statically, so the menu's chunk was the whole game — 2.1MB of modules,
 *   79% of it `game/gameObject`, all parsed before the logo could be drawn.
 *   The imports below are dynamic, which is what lets Rollup cut the game out
 *   of the menu chunk; calling them here means the split costs no waiting.
 * - **Art.** A match used to start with `AssetManager.renderable` handing back
 *   placeholder squares and swapping in champion portraits and spell icons as
 *   they arrived. Loading them against a progress bar on the menu turns a
 *   match-long trickle of pop-in into a wait the player can see the end of.
 *
 * Runs once per page load: the promise is module state, so returning to the
 * menu from the pregame screen finds it already resolved and the bar already
 * gone.
 */

/**
 * What is worth *waiting* for, which is a much smaller set than what a match
 * eventually draws.
 *
 * The rule is: preload what appears on the field the instant a match opens and
 * would otherwise be a placeholder square, and let everything else stream in
 * through `AssetManager.renderable`, which already swaps art in as it arrives.
 *
 * - `champ_` (58 files, ~790KB) — bodies are on screen from the first frame.
 * - `buff_`, `monster_`, `obj_` (29 files, ~130KB) — small, and universal.
 * - **`spell_` is deliberately excluded** (310 files, ~1.45MB — the largest
 *   group by far). Spell icons appear in the HUD, at most seven of them at a
 *   time, for whichever kit the player actually took; fetching all 310 to show
 *   seven was over half the preload for almost none of the benefit.
 * - `other_` is the menu's own art — one background and the logo, both already
 *   on screen by the time this runs — and `screenshot_`/`source_manifest` are
 *   developer assets nothing renders.
 *
 * Widening this is a one-line change if the pop-in ever matters more than the
 * wait; the numbers above are what the trade is.
 */
const MATCH_ASSET_PREFIXES = ['champ_', 'buff_', 'monster_', 'obj_'] as const;

function matchAssetKeys(): AssetKey[] {
  const keys: AssetKey[] = [];
  for (const key of Object.keys(assetManifest) as AssetKey[]) {
    if (assetManifest[key].kind !== 'image') continue;
    if (MATCH_ASSET_PREFIXES.some(prefix => key.startsWith(prefix))) keys.push(key);
  }
  return keys;
}

export interface PreloadState {
  /** Units finished, out of `total`. */
  readonly loaded: number;
  readonly total: number;
  /** 0 to 1. `1` before `done` is possible — the last tick and the finish differ. */
  readonly ratio: number;
  /** Nothing further is coming. True even when some of it failed. */
  readonly done: boolean;
  /**
   * The game's code could not be fetched. The menu still offers Play — pressing
   * it retries the import — because a menu with no way into a match is a worse
   * failure than a slow one.
   */
  readonly codeFailed: boolean;
}

const state = {
  loaded: 0,
  total: 0,
  done: false,
  codeFailed: false,
};

const watchers = new Set<(state: PreloadState) => void>();

function snapshot(): PreloadState {
  return {
    loaded: state.loaded,
    total: state.total,
    ratio: state.total === 0 ? 0 : Math.min(1, state.loaded / state.total),
    done: state.done,
    codeFailed: state.codeFailed,
  };
}

function announce(): void {
  const current = snapshot();
  for (const watcher of watchers) watcher(current);
}

/** Subscribe, and receive the state immediately. Returns the unsubscribe. */
export function watchPreload(watcher: (state: PreloadState) => void): () => void {
  watchers.add(watcher);
  watcher(snapshot());
  return () => {
    watchers.delete(watcher);
  };
}

export function preloadState(): PreloadState {
  return snapshot();
}

/**
 * The two scene classes, fetched on demand.
 *
 * Kept as functions rather than resolved once into variables so that pressing
 * Chơi after a failed preload retries the network instead of being permanently
 * dead. A second call after a success is free — the module is already in the
 * bundler's registry.
 */
export const loadGameScene = (): Promise<typeof GameScene> =>
  import('./GameScene').then(module => module.default);

export const loadSetupScene = (): Promise<typeof SetupScene> =>
  import('./SetupScene').then(module => module.default);

let running: Promise<void> | null = null;

/**
 * Start the warm-up, or hand back the one already running.
 *
 * **Never rejects.** A missing image is not a reason to withhold the game, and
 * the caller's only sane response to a failure here would be to show Play
 * anyway — so that decision is made once, here, rather than at each call site.
 */
export function preloadGame(): Promise<void> {
  if (running) return running;

  const keys = matchAssetKeys();
  // Two units for the two code chunks, so the bar moves immediately on a warm
  // cache rather than sitting at zero until the first image lands.
  state.total = keys.length + 2;
  state.loaded = 0;
  state.done = false;
  state.codeFailed = false;
  announce();

  const step = () => {
    state.loaded += 1;
    announce();
  };

  running = (async () => {
    const code = Promise.all([loadGameScene().then(step), loadSetupScene().then(step)]).catch(
      () => {
        state.codeFailed = true;
        // The two units still have to land or the bar can never reach the end.
        state.loaded += 2;
        announce();
      }
    );

    const art = keys.map(key =>
      AssetManager.ensure(key)
        .catch(() => undefined)
        .then(step)
    );

    await Promise.all([code, ...art]);
    state.done = true;
    announce();
  })();

  return running;
}

/** Test seam: forget the run so another one can be observed from the start. */
export function resetPreloadForTests(): void {
  running = null;
  state.loaded = 0;
  state.total = 0;
  state.done = false;
  state.codeFailed = false;
  watchers.clear();
}
