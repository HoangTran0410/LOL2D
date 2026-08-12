import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { getAsset: vi.fn(() => undefined) },
}));

import Lux_R from '../../../src/game/gameObject/spells/Lux_R';
import Flash from '../../../src/game/gameObject/spells/Flash';
import Ghost from '../../../src/game/gameObject/spells/Ghost';
import Heal from '../../../src/game/gameObject/spells/Heal';
import Ignite from '../../../src/game/gameObject/spells/Ignite';
import Lux_E, { Lux_E_Object } from '../../../src/game/gameObject/spells/Lux_E';
import Spell from '../../../src/game/gameObject/Spell';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import CastBar from '../../../src/game/vfx/CastBar';
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
  addBuff: (buff: unknown) => void;
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
    const disposeCastBar = vi.spyOn(CastBar.prototype, 'dispose');
    const added: unknown[] = [];
    const targetBuffs: unknown[] = [];
    const ownerBuffs: Array<{ toRemove: boolean; statusFlagsToEnable: number }> = [];
    const target: TestTarget = {
      position: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      isDead: false,
      takeDamage: vi.fn(),
      addBuff: buff => targetBuffs.push(buff),
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
      stopMovement: vi.fn(),
      addBuff: (buff: { activateBuff(): void; toRemove: boolean; statusFlagsToEnable: number }) => {
        ownerBuffs.push(buff);
        buff.activateBuff();
      },
      stats: { mana: { value: 200 }, health: { value: 100 } },
    };
    const spell = new Lux_R(owner);

    spell.press(context(owner));

    expect(spell.state).toBe('CASTING');
    expect(spell.coolDown).toBe(60_000);
    expect(spell.manaCost).toBe(100);
    expect(owner.stats.mana.value).toBe(100);
    expect(owner.stopMovement).toHaveBeenCalledOnce();
    expect(ownerBuffs).toHaveLength(1);
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Stunned).toBeFalsy();
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Immovable).toBeTruthy();
    expect(target.takeDamage).not.toHaveBeenCalled();
    expect(spell.cancel('MOVE')).toBe(false);
    expect(spell.cancel('STUN')).toBe(false);

    owner.position.x = 50;
    vi.stubGlobal('deltaTime', 1_000);
    spell.update();

    expect(disposeCastBar).toHaveBeenCalledOnce();

    const beam = added.find(object => object instanceof BeamSpellObject) as BeamSpellObject<TestTarget>;
    expect(beam.geometry).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 3400, y: 0 },
      width: 200,
    });
    expect(target.takeDamage).not.toHaveBeenCalled();

    beam.update();

    expect(target.takeDamage).toHaveBeenCalledWith(30, owner);
    expect(targetBuffs).toHaveLength(1);
    expect(targetBuffs[0]).toMatchObject({ duration: 1_500, visionRadius: 150 });
    expect(ownerBuffs[0].toRemove).toBe(true);
  });

  it('locks only prohibited actions and restores their prior state exactly once', () => {
    class ProhibitedSpell extends Spell {}

    const added: unknown[] = [];
    const ownerBuffs: Array<{
      activateBuff(): void;
      deactivateBuff(): void;
      statusFlagsToEnable: number;
    }> = [];
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: unknown) => added.push(object),
          queryObjects: () => [],
        },
      },
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement: vi.fn(),
      addBuff: (buff: typeof ownerBuffs[number]) => {
        ownerBuffs.push(buff);
        buff.activateBuff();
      },
      stats: { mana: { value: 500 }, health: { value: 100 } },
      spells: [] as Spell[],
    };
    const spell = new Lux_R(owner);
    const ghost = new Ghost(owner);
    const heal = new Heal(owner);
    const ignite = new Ignite(owner);
    const flash = new Flash(owner);
    const recast = new Lux_E(owner);
    recast.luxEObject = { phase: Lux_E_Object.PHASES.STATIC } as Lux_E_Object;
    const freshLuxE = new Lux_E(owner);
    const prohibited = new ProhibitedSpell(owner);
    const alreadyDisabled = new ProhibitedSpell(owner);
    alreadyDisabled.disabled = true;
    owner.spells = [spell, ghost, heal, ignite, flash, recast, freshLuxE, prohibited, alreadyDisabled];

    spell.press(context(owner));

    expect(owner.canCast).toBe(true);
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Stunned).toBeFalsy();
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Immovable).toBeTruthy();
    expect([ghost, heal, ignite, flash, recast].every(candidate => !candidate.disabled)).toBe(true);
    expect(freshLuxE.disabled).toBe(true);
    expect(prohibited.castCancelCheck()).toBe(true);

    ownerBuffs[0].deactivateBuff();
    ownerBuffs[0].deactivateBuff();

    expect(prohibited.disabled).toBe(false);
    expect(alreadyDisabled.disabled).toBe(true);
  });

  it('grants sight along the frozen beam during the cast and briefly after release', () => {
    const added: Array<{
      position?: { x: number; y: number };
      visionRadius?: number;
      teamId?: string;
      toRemove?: boolean;
      update?: (deltaMs?: number) => void;
    }> = [];
    const ownerBuffs: Array<{ activateBuff(): void }> = [];
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: typeof added[number]) => added.push(object),
          queryObjects: () => [],
        },
      },
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement: vi.fn(),
      addBuff: (buff: { activateBuff(): void }) => {
        ownerBuffs.push(buff);
        buff.activateBuff();
      },
      stats: { mana: { value: 200 }, health: { value: 100 } },
    };
    const spell = new Lux_R(owner);

    spell.press(context(owner));

    const sight = added.filter(object => (object.visionRadius ?? 0) > 0);
    expect(sight.length).toBeGreaterThan(1);
    expect(sight.every(object => object.teamId === 'blue')).toBe(true);
    expect(Math.min(...sight.map(object => object.position!.x))).toBe(0);
    expect(Math.max(...sight.map(object => object.position!.x))).toBe(3_400);

    sight.forEach(object => object.update?.(1_499));
    expect(sight.every(object => object.toRemove === false)).toBe(true);
    sight.forEach(object => object.update?.(1));
    expect(sight.every(object => object.toRemove === true)).toBe(true);
  });
});
