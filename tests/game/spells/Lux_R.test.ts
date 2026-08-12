import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { getAsset: vi.fn(() => undefined) },
}));

import Lux_R from '../../../src/game/gameObject/spells/Lux_R';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  add(x: number, y: number) { this.x += x; this.y += y; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(length: number) {
    const magnitude = this.mag();
    if (magnitude > 0) {
      this.x = (this.x / magnitude) * length;
      this.y = (this.y / magnitude) * length;
    }
    return this;
  }
  static add(first: TestVector, second: TestVector) {
    return new TestVector(first.x + second.x, first.y + second.y);
  }
  static sub(first: TestVector, second: TestVector) {
    return new TestVector(first.x - second.x, first.y - second.y);
  }
}

interface TestTarget {
  position: TestVector;
  collisionRadius: number;
  teamId: string;
  isDead: boolean;
  takeDamage: (damage: number, source: unknown) => void;
}

const context = (caster: unknown): CastContext => Object.freeze({
  spellId: 'lux-r',
  activationId: 'cast',
  startedAtMs: 0,
  caster,
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 100, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

describe('Lux R', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('p5', { Vector: TestVector });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('snapshots its beam and deals damage only after cast completion', () => {
    const added: unknown[] = [];
    const target: TestTarget = {
      position: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      isDead: false,
      takeDamage: vi.fn(),
    };
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: unknown) => added.push(object),
          queryObjects: () => [target],
        },
      },
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      canCast: true,
      addBuff: vi.fn(),
      stats: { mana: { value: 100 }, health: { value: 100 } },
    };
    const spell = new Lux_R(owner);

    spell.press(context(owner));

    expect(spell.state).toBe('CASTING');
    expect(target.takeDamage).not.toHaveBeenCalled();
    expect(spell.cancel('MOVE')).toBe(false);
    expect(spell.cancel('STUN')).toBe(false);

    owner.position.x = 50;
    vi.stubGlobal('deltaTime', 1_000);
    spell.update();

    const beam = added[0] as BeamSpellObject<TestTarget>;
    expect(beam.geometry).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 3400, y: 0 },
      width: 200,
    });
    expect(target.takeDamage).not.toHaveBeenCalled();

    beam.update();

    expect(target.takeDamage).toHaveBeenCalledWith(30, owner);
  });
});
