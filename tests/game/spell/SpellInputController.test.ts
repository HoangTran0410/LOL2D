import { describe, expect, it, vi } from 'vitest';
import { SpellInputController } from '../../../src/game/spell/input/SpellInputController';
import type {
  ActivationPattern,
  CastContext,
  SpellRuntimeState,
} from '../../../src/game/spell/runtime/types';

const context: CastContext = Object.freeze({
  spellId: 'spell',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 1, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

const setup = (state: SpellRuntimeState = 'READY') => {
  const spell = {
    state,
    press: vi.fn(() => true),
    hold: vi.fn(() => true),
    release: vi.fn(() => true),
    cancel: vi.fn(() => true),
  };
  const createContext = vi.fn(() => context);
  const controller = new SpellInputController({
    keyBindings: [81],
    getSpell: () => spell,
    createContext,
  });

  return { controller, spell, createContext };
};

describe('SpellInputController', () => {
  it('emits one PRESS for repeated keydown events', () => {
    const { controller, spell } = setup();

    controller.keyDown(81, false);
    controller.keyDown(81, true);
    controller.keyDown(81, false);

    expect(spell.press).toHaveBeenCalledTimes(1);
    expect(spell.press).toHaveBeenCalledWith(context);
  });

  it('emits HOLD updates only while the slot remains down', () => {
    const { controller, spell, createContext } = setup('CHARGING');

    controller.update(10);
    controller.keyDown(81, false);
    controller.update(16);
    controller.update(20);
    controller.keyUp(81);
    controller.update(30);

    expect(spell.hold).toHaveBeenCalledTimes(2);
    expect(createContext).toHaveBeenCalledWith(spell, 0, 16);
    expect(createContext).toHaveBeenCalledWith(spell, 0, 36);
  });

  it('emits one RELEASE on keyup', () => {
    const { controller, spell } = setup('CHARGING');

    controller.keyDown(81, false);
    controller.keyUp(81);
    controller.keyUp(81);

    expect(spell.release).toHaveBeenCalledTimes(1);
    expect(spell.release).toHaveBeenCalledWith(context);
  });

  it('does not release a RECAST spell from physical keyup', () => {
    const { controller, spell } = setup('ACTIVE');

    controller.keyDown(81, false);
    controller.keyUp(81);

    expect(spell.release).not.toHaveBeenCalled();
  });

  it('cancels every bound spell on scene exit', () => {
    const first = setup();
    const secondSpell = {
      ...first.spell,
      cancel: vi.fn(() => true),
    };
    const controller = new SpellInputController({
      keyBindings: [81, 87],
      getSpell: slot => (slot === 0 ? first.spell : secondSpell),
      createContext: () => context,
    });

    controller.keyDown(81, false);
    controller.keyUp(81);
    controller.cancelAll('SCENE_EXIT');

    expect(first.spell.cancel).toHaveBeenCalledWith('SCENE_EXIT');
    expect(secondSpell.cancel).toHaveBeenCalledWith('SCENE_EXIT');
  });
});

const touchSetup = (activation: ActivationPattern, state: SpellRuntimeState = 'READY') => {
  const spell = {
    state,
    castSpec: { activation },
    press: vi.fn(() => true),
    hold: vi.fn(() => true),
    release: vi.fn(() => true),
    cancel: vi.fn(() => true),
  };
  const createContext = vi.fn(() => context);
  const controller = new SpellInputController({
    keyBindings: [81],
    getSpell: () => spell,
    createContext,
  });
  return { controller, spell, createContext };
};

describe('SpellInputController pointer gestures', () => {
  it('does not cast a PRESS spell when the thumb lands', () => {
    const { controller, spell } = touchSetup('PRESS');

    controller.pointerDown(0);

    // The whole point of the deferral: press() casts, and on glass the aim
    // has not happened yet when the finger touches down.
    expect(spell.press).not.toHaveBeenCalled();
    expect(controller.isPointerHeld(0)).toBe(true);
  });

  it('casts a PRESS spell once, on release, with the final aim', () => {
    const { controller, spell, createContext } = touchSetup('PRESS');

    controller.pointerDown(0);
    controller.update(120);
    controller.pointerUp(0);

    expect(spell.press).toHaveBeenCalledTimes(1);
    expect(spell.press).toHaveBeenCalledWith(context);
    // The context is built at release, so it carries where the drag ended.
    expect(createContext).toHaveBeenCalledWith(spell, 0, 120);
    expect(controller.isPointerHeld(0)).toBe(false);
  });

  it('spends nothing at all when a PRESS gesture is cancelled', () => {
    const { controller, spell, createContext } = touchSetup('PRESS');

    controller.pointerDown(0);
    controller.update(200);
    controller.pointerCancel(0);
    controller.pointerUp(0);

    expect(spell.press).not.toHaveBeenCalled();
    expect(spell.release).not.toHaveBeenCalled();
    // Never pressed means there is nothing to cancel through the runtime
    // either — no refund path, no event, no cooldown.
    expect(spell.cancel).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it('starts a charge the moment the thumb lands and holds it while dragging', () => {
    const { controller, spell } = touchSetup('HOLD_RELEASE');

    controller.pointerDown(0);
    expect(spell.press).toHaveBeenCalledTimes(1);

    spell.state = 'CHARGING';
    controller.update(16);
    controller.update(16);

    expect(spell.hold).toHaveBeenCalledTimes(2);
  });

  it('releases a charge when the thumb lifts', () => {
    const { controller, spell } = touchSetup('TAP_OR_HOLD');

    controller.pointerDown(0);
    spell.state = 'CHARGING';
    controller.update(400);
    controller.pointerUp(0);

    expect(spell.release).toHaveBeenCalledTimes(1);
    expect(spell.press).toHaveBeenCalledTimes(1);
  });

  it('cancels a running charge through the runtime', () => {
    const { controller, spell } = touchSetup('HOLD_RELEASE');

    controller.pointerDown(0);
    spell.state = 'CHARGING';
    controller.pointerCancel(0);

    expect(spell.cancel).toHaveBeenCalledWith('PLAYER_CANCEL');
    expect(spell.release).not.toHaveBeenCalled();
  });

  it('never holds a slot whose press was deferred', () => {
    const { controller, spell, createContext } = touchSetup('PRESS');

    controller.pointerDown(0);
    controller.update(16);

    expect(spell.hold).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it('ignores a second thumb landing on a slot already held', () => {
    const { controller, spell } = touchSetup('HOLD_RELEASE');

    expect(controller.pointerDown(0)).toBe(true);
    expect(controller.pointerDown(0)).toBe(false);
    expect(spell.press).toHaveBeenCalledTimes(1);
  });

  it('drops held gestures on scene exit', () => {
    const { controller, spell } = touchSetup('PRESS');

    controller.pointerDown(0);
    controller.cancelAll('SCENE_EXIT');

    expect(controller.isPointerHeld(0)).toBe(false);
    expect(controller.pointerUp(0)).toBe(false);
    expect(spell.press).not.toHaveBeenCalled();
  });
});
