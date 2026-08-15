import { afterEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => vi.unstubAllGlobals());

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
