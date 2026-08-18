import type GameScene from './GameScene';
import type SetupScene from './SetupScene';

/**
 * The menu's warm-up: the game's *code*, fetched while the player is looking at
 * the main menu instead of after they press Chơi.
 *
 * `MenuScene` used to `import GameScene` and `SetupScene` statically, so the
 * menu's chunk was the whole game — 2.1MB of modules, 79% of it
 * `game/gameObject`, all parsed before the logo could be drawn. The imports
 * below are dynamic, which is what lets Rollup cut the game out of the menu
 * chunk; calling them here means the split costs no waiting.
 *
 * Runs once per page load: the promise is module state, so returning to the
 * menu from the pregame screen finds it already resolved and the bar already
 * gone.
 *
 * ## Match art is **not** preloaded here any more.
 *
 * This used to fetch every `champ_`/`buff_`/`monster_`/`obj_` image before Chơi
 * appeared — 88 files, ~2.1MB — on the theory that a match should not open on
 * placeholder squares. Two things made that the wrong place for it:
 *
 *  - It is the same mistake the spell barrel made. A menu cannot know which
 *    champions a match will field, so "load what a match needs" from here means
 *    "load all of them", and 50 of the 58 portraits are for champions nobody in
 *    this match is playing.
 *  - There is now somewhere better. `GameScene.startGame` knows the exact
 *    roster (`planMatchKits`) and already waits there with a progress screen for
 *    the spell chunks, so the art rides along with them: six portraits instead
 *    of fifty-eight, behind a bar the player can see.
 *
 * What is left is the game's *code*, which the menu genuinely can fetch ahead —
 * it is the same two chunks whatever the match turns out to be.
 */

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

  // Two units, for the two code chunks.
  state.total = 2;
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

    await code;
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
