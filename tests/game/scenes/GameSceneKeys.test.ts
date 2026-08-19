import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Game from '../../../src/game/Game';
import InGameHUD from '../../../src/game/hud/InGameHUD';
import GameScene from '../../../src/scenes/GameScene';
import { createHudInteractions } from '../../../src/game/hud/hudInteractions';

/**
 * Escape, which used to end the match outright.
 *
 * The assertion that matters is on the **scene manager**, not on a flag the
 * handler sets: the regression being prevented is "Escape left the match", and
 * only the scene manager knows whether that happened.
 *
 * `GameScene` is constructed directly rather than booted — `keyPressed` reads
 * `this.sceneManager` and `this.game` and nothing else, so no p5 canvas, no
 * DOM and no real `Game` are involved.
 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Game pause lifecycle', () => {
  it('notifies the runtime once for each real pause state change', () => {
    const onPauseChanged = vi.fn();
    const game = { paused: false, onPauseChanged };

    Game.prototype.pause.call(game as unknown as Game);
    Game.prototype.pause.call(game as unknown as Game);
    Game.prototype.unpause.call(game as unknown as Game);
    Game.prototype.unpause.call(game as unknown as Game);

    expect(onPauseChanged.mock.calls).toEqual([[true], [false]]);
  });

  it('wires the game pause callback to the scene runtime owner', () => {
    const source = readFileSync('src/scenes/GameScene.ts', 'utf8');

    expect(source).toContain('this.game.onPauseChanged = this._handleGamePause');
    expect(source).toContain('this.game?.inGameHUD.setUpdatesPaused(paused)');
  });
});

describe('GameScene paused runtime', () => {
  const runtime = (scene: GameScene) =>
    scene as unknown as {
      _animationFrameId: number | null;
      _handleGamePause?: (paused: boolean) => void;
    };

  it('stops both game loops while the modal owns pause', () => {
    const clearTimeout = vi.fn();
    const noLoop = vi.fn();
    vi.stubGlobal('clearTimeout', clearTimeout);
    vi.stubGlobal('noLoop', noLoop);
    vi.stubGlobal('document', { hidden: false });
    const scene = new GameScene({} as never);
    const setUpdatesPaused = vi.fn();
    scene.game = { paused: true, inGameHUD: { setUpdatesPaused } } as never;
    runtime(scene)._animationFrameId = 42;

    const handlePause = runtime(scene)._handleGamePause;
    expect(handlePause).toBeTypeOf('function');
    handlePause?.(true);

    expect(clearTimeout).toHaveBeenCalledWith(42);
    expect(runtime(scene)._animationFrameId).toBeNull();
    expect(noLoop).toHaveBeenCalledOnce();
    expect(setUpdatesPaused).toHaveBeenCalledWith(true);
  });

  it('resets both clocks before restarting after the modal closes', () => {
    const p5Instance: Record<string, number> = {};
    const loop = vi.fn();
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('performance', { now: () => 321 });
    vi.stubGlobal('window', { p5: { instance: p5Instance } });
    vi.stubGlobal('loop', loop);
    const scene = new GameScene({} as never);
    const setUpdatesPaused = vi.fn();
    scene.game = { paused: false, inGameHUD: { setUpdatesPaused } } as never;
    scene.updateLoop = vi.fn();

    const handlePause = runtime(scene)._handleGamePause;
    expect(handlePause).toBeTypeOf('function');
    handlePause?.(false);

    expect(p5Instance._lastRealFrameTime).toBe(321);
    expect(p5Instance._lastTargetFrameTime).toBe(321);
    expect(loop).toHaveBeenCalledOnce();
    expect(scene.updateLoop).toHaveBeenCalledOnce();
    expect(setUpdatesPaused).toHaveBeenCalledWith(false);
  });

  it('restarts p5 for the next scene when leaving through the paused panel', () => {
    const loop = vi.fn();
    vi.stubGlobal('loop', loop);
    vi.stubGlobal('document', { hidden: false, removeEventListener: vi.fn() });
    vi.stubGlobal('window', { removeEventListener: vi.fn() });
    const scene = new GameScene({} as never);
    scene.game = {
      paused: true,
      onPauseChanged: vi.fn(),
      spellInputController: { cancelAll: vi.fn() },
      destroy: vi.fn(),
    } as never;
    scene.dom = { style: {} } as HTMLElement;
    scene.canvas = { remove: vi.fn() };

    scene.exit();

    expect(loop).toHaveBeenCalledOnce();
  });
});

describe('paused HUD polling', () => {
  it('cancels while paused and restarts only once on resume', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const startUpdateLoop = vi.fn(function (this: { _rafId: number | null }) {
      this._rafId = 8;
    });
    const hud: { _rafId: number | null; _startUpdateLoop: typeof startUpdateLoop } = {
      _rafId: 7,
      _startUpdateLoop: startUpdateLoop,
    };
    const setUpdatesPaused = (
      InGameHUD.prototype as unknown as {
        setUpdatesPaused?: (paused: boolean) => void;
      }
    ).setUpdatesPaused;

    expect(setUpdatesPaused).toBeTypeOf('function');
    setUpdatesPaused?.call(hud, true);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(hud._rafId).toBeNull();

    setUpdatesPaused?.call(hud, false);
    setUpdatesPaused?.call(hud, false);

    expect(hud._rafId).toBe(8);
    expect(startUpdateLoop).toHaveBeenCalledOnce();
  });

  it('syncs the touch layout directly while polling is paused', () => {
    const hud = { view: { hud: { touchUi: true } } };
    const setTouchUi = (
      InGameHUD.prototype as unknown as {
        setTouchUi?: (enabled: boolean) => void;
      }
    ).setTouchUi;

    expect(setTouchUi).toBeTypeOf('function');
    setTouchUi?.call(hud, false);

    expect(hud.view.hud.touchUi).toBe(false);
  });

  it('pushes touch mode changes to the HUD without waiting for its timer', () => {
    const setTouchUi = vi.fn();
    const game = {
      touchControls: { setEnabled: vi.fn(), enabled: false },
      touchUi: true,
      inGameHUD: { setTouchUi },
      applyTouchUiClass: vi.fn(),
    };

    Game.prototype.setTouchControlsEnabled.call(game as unknown as Game, false, false);

    expect(setTouchUi).toHaveBeenCalledWith(false);
  });
});

const gameScene = () => {
  const sceneManager = { showScene: vi.fn() };
  // `createHudInteractions` reads `game.player?.spells` and calls
  // `pause`/`unpause`; nothing else of `Game` is reachable from Escape.
  const hudGame = {
    player: { spells: [{}, {}] },
    pause: vi.fn(),
    unpause: vi.fn(),
  } as never;
  const hud = createHudInteractions(hudGame);
  // `Game.escape()` is exactly this one line, and it is the line under test at
  // the scene level: Escape now reaches the HUD instead of the scene manager.
  const game = { escape: () => hud.escape(), keyPressed: vi.fn() };
  const scene = new GameScene(sceneManager as never);
  scene.game = game as never;
  return { scene, sceneManager, hud, game };
};

describe('GameScene.keyPressed — Escape', () => {
  it('Escape no longer leaves the match', () => {
    const { scene, sceneManager } = gameScene();
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);
    expect(sceneManager.showScene).not.toHaveBeenCalled();
  });

  it('Escape toggles the practice panel instead', () => {
    const { scene, hud } = gameScene();
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);
    expect(hud.showSpellsPicker).toBe(true);
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);
    expect(hud.showSpellsPicker).toBe(false);
  });

  /**
   * 27 is not one of `SpellHotKeys`, and `Game.keyPressed` binds only 32 and
   * 78 — but a key that opens a modal must not also reach the cast path, or a
   * future binding on 27 would fire underneath the panel it just opened.
   */
  it('Escape does not also reach the game keyboard handler', () => {
    const { scene, game } = gameScene();
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);
    expect(game.keyPressed).not.toHaveBeenCalled();
  });

  it('every other key still reaches the game', () => {
    const { scene, game, sceneManager } = gameScene();
    scene.keyPressed({ keyCode: 32 } as KeyboardEvent);
    expect(game.keyPressed).toHaveBeenCalledWith(32, false);
    expect(sceneManager.showScene).not.toHaveBeenCalled();
  });
});

describe('HudInteractions.escape — the innermost layer first', () => {
  it('closes an inner modal instead of the panel, once', () => {
    const { scene, hud } = gameScene();
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);

    // What `RosterTab` registers while its loadout editor is open.
    const closeInner = vi.fn(() => true);
    hud.onEscapeInner = closeInner;
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);

    expect(closeInner).toHaveBeenCalledOnce();
    expect(hud.showSpellsPicker).toBe(true);
  });

  it('falls through to the panel when the inner layer says it did nothing', () => {
    const { scene, hud } = gameScene();
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);

    hud.onEscapeInner = () => false;
    scene.keyPressed({ keyCode: 27 } as KeyboardEvent);

    expect(hud.showSpellsPicker).toBe(false);
  });
});

describe('the way out that replaces Escape', () => {
  it('requestExit goes through the callback GameScene set, not the scene manager', () => {
    const onExitRequested = vi.fn();
    const hud = createHudInteractions({
      player: { spells: [] },
      pause: vi.fn(),
      unpause: vi.fn(),
      onExitRequested,
    } as never);

    hud.requestExit();

    expect(onExitRequested).toHaveBeenCalledOnce();
    expect(hud.showSpellsPicker).toBe(false);
  });
});

describe('GameScene touch ownership', () => {
  it('forwards canvas touches to the game and cancels browser gestures', () => {
    const canvas = {};
    const syncTouches = vi.fn();
    const scene = new GameScene({} as never);
    scene.canvas = { elt: canvas };
    scene.game = { syncTouches } as never;
    vi.stubGlobal('touches', [{ id: 7, x: 120, y: 240 }]);

    const handled = scene.touchStarted({ target: canvas } as TouchEvent);

    expect(handled).toBe(false);
    expect(syncTouches).toHaveBeenCalledWith([{ id: 7, x: 120, y: 240 }]);
  });

  it('leaves settings-overlay touches to native DOM scrolling and controls', () => {
    const canvas = {};
    const overlay = {};
    const syncTouches = vi.fn();
    const scene = new GameScene({} as never);
    scene.canvas = { elt: canvas };
    scene.game = { syncTouches } as never;
    vi.stubGlobal('touches', [{ id: 8, x: 320, y: 180 }]);

    const handled = scene.touchMoved({ target: overlay } as TouchEvent);

    expect(handled).toBeUndefined();
    expect(syncTouches).not.toHaveBeenCalled();
  });
});

/**
 * Leaving the page mid-match.
 *
 * The match used to keep running while the player was somewhere else — another
 * app, a locked phone, a different tab — so coming back meant walking into a
 * fight that had already happened. Hiding the page now stops it *and* puts the
 * panel up, which is both the paused state made visible and the way out of it.
 *
 * `Game.pauseForAway` is the seam, and it deliberately routes through
 * `HudInteractions.openSpellPicker` rather than calling `pause()` beside its
 * own copy of the open bookkeeping — the panel already pauses, so "open the
 * panel" *is* "pause" and there is only ever one of them.
 */
const awayMatch = ({ mounted = true } = {}) => {
  const game: Record<string, unknown> = {
    paused: false,
    player: { spells: [{}, {}] },
  };
  game.pause = vi.fn(() => {
    game.paused = true;
  });
  game.unpause = vi.fn(() => {
    game.paused = false;
  });
  const hud = createHudInteractions(game as never);
  game.inGameHUD = mounted ? { vueInstance: { hud } } : undefined;
  return { game: game as unknown as Game, raw: game, hud };
};

describe('Game.pauseForAway — the player stopped looking', () => {
  it('pauses the match and puts the panel up', () => {
    const { game, hud } = awayMatch();

    Game.prototype.pauseForAway.call(game);

    expect(hud.showSpellsPicker).toBe(true);
    expect(game.paused).toBe(true);
  });

  it('leaves a panel the player already opened exactly as they left it', () => {
    const { game, hud } = awayMatch();
    // The desktop strip's shortcut: panel open, aimed at one slot.
    hud.openPlayerLoadout(3);

    Game.prototype.pauseForAway.call(game);

    expect(hud.showSpellsPicker).toBe(true);
    // `openSpellPicker` clears this, so a second open would be visible here.
    expect(hud.editPlayerSlot).toBe(3);
  });

  it('still stops a match whose HUD is not mounted', () => {
    const { game, raw } = awayMatch({ mounted: false });

    Game.prototype.pauseForAway.call(game);

    expect(raw.pause).toHaveBeenCalledOnce();
    expect(game.paused).toBe(true);
  });
});

describe('GameScene — leaving and returning to the page', () => {
  const away = (scene: GameScene) =>
    scene as unknown as {
      _handleVisibilityChange: () => void;
      _handleWindowBlur: () => void;
    };

  it('pauses the match and stops the runtime when the page is hidden', () => {
    vi.stubGlobal('clearTimeout', vi.fn());
    const noLoop = vi.fn();
    vi.stubGlobal('noLoop', noLoop);
    vi.stubGlobal('document', { hidden: true });
    const scene = new GameScene({} as never);
    const pauseForAway = vi.fn();
    scene.game = { paused: false, pauseForAway } as never;

    away(scene)._handleVisibilityChange();

    expect(pauseForAway).toHaveBeenCalledOnce();
    expect(noLoop).toHaveBeenCalledOnce();
  });

  it('treats the window losing focus the same way', () => {
    vi.stubGlobal('clearTimeout', vi.fn());
    vi.stubGlobal('noLoop', vi.fn());
    // Not hidden: another window took focus, which `visibilitychange` never
    // reports.
    vi.stubGlobal('document', { hidden: false });
    const scene = new GameScene({} as never);
    const pauseForAway = vi.fn();
    scene.game = { paused: false, pauseForAway } as never;

    away(scene)._handleWindowBlur();

    expect(pauseForAway).toHaveBeenCalledOnce();
  });

  it('does not resume the match when the page comes back', () => {
    const loop = vi.fn();
    vi.stubGlobal('loop', loop);
    vi.stubGlobal('document', { hidden: false });
    const scene = new GameScene({} as never);
    const unpause = vi.fn();
    scene.game = { paused: true, unpause } as never;
    scene.updateLoop = vi.fn();

    away(scene)._handleVisibilityChange();

    expect(unpause).not.toHaveBeenCalled();
    expect(loop).not.toHaveBeenCalled();
    expect(scene.updateLoop).not.toHaveBeenCalled();
  });

  it('removes both away listeners when the scene exits', () => {
    const documentRemove = vi.fn();
    const windowRemove = vi.fn();
    vi.stubGlobal('document', { hidden: false, removeEventListener: documentRemove });
    vi.stubGlobal('window', { removeEventListener: windowRemove });
    const scene = new GameScene({} as never);
    scene.game = {
      paused: false,
      onPauseChanged: vi.fn(),
      spellInputController: { cancelAll: vi.fn() },
      destroy: vi.fn(),
    } as never;
    scene.dom = { style: {} } as HTMLElement;
    scene.canvas = { remove: vi.fn() };
    const handlers = away(scene);

    scene.exit();

    expect(documentRemove).toHaveBeenCalledWith(
      'visibilitychange',
      handlers._handleVisibilityChange
    );
    expect(windowRemove).toHaveBeenCalledWith('blur', handlers._handleWindowBlur);
  });

  /**
   * The other half of the leak: `exit()` can only unhook what `enter()` hooked
   * *by the same reference*, and scenes here are switched rather than reloaded,
   * so a mismatch leaves a listener holding a dead `Game` for the rest of the
   * session. The removal above is behavioural; this is the add side, which no
   * unit test can reach without a p5 canvas.
   */
  it('adds exactly the two handlers it removes', () => {
    const source = readFileSync('src/scenes/GameScene.ts', 'utf8');

    expect(source).toContain(
      "document.addEventListener('visibilitychange', this._handleVisibilityChange)"
    );
    expect(source).toContain("window.addEventListener('blur', this._handleWindowBlur)");
  });
});
