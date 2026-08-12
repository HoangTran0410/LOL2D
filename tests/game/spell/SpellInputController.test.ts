import { describe, expect, it, vi } from 'vitest';
import { SpellInputController } from '../../../src/game/spell/input/SpellInputController';
import type { CastContext, SpellRuntimeState } from '../../../src/game/spell/runtime/types';

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
      getSpell: slot => slot === 0 ? first.spell : secondSpell,
      createContext: () => context,
    });

    controller.keyDown(81, false);
    controller.keyUp(81);
    controller.cancelAll('SCENE_EXIT');

    expect(first.spell.cancel).toHaveBeenCalledWith('SCENE_EXIT');
    expect(secondSpell.cancel).toHaveBeenCalledWith('SCENE_EXIT');
  });
});
