import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loopDispose = vi.hoisted(() => vi.fn());

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { getAsset: vi.fn(() => undefined) },
}));

vi.mock('../../../src/game/vfx/CastTelegraph', () => ({
  default: class {
    update() {}
    draw() {}
    dispose() { loopDispose(); }
  },
}));

import Janna_R from '../../../src/game/gameObject/spells/Janna_R';
import * as AllSpells from '../../../src/game/gameObject/spells/index';
import AreaSpellObject from '../../../src/game/gameObject/spellObjects/AreaSpellObject';
import { SpellGroups } from '../../../src/game/preset';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
}

interface TestUnit {
  position: TestVector;
  collisionRadius: number;
  teamId: string;
  isDead: boolean;
  addBuff: (buff: unknown) => void;
  takeHeal: (amount: number, healer: unknown) => void;
}

const context = (caster: unknown): CastContext => Object.freeze({
  spellId: 'janna-r',
  activationId: 'cast',
  startedAtMs: 0,
  caster,
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 0, y: 0 }),
  direction: Object.freeze({ x: 0, y: 0 }),
});

describe('Janna R', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
    loopDispose.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('exports and registers Monsoon in Janna’s spell group', () => {
    const group = SpellGroups.find(candidate => candidate.name === 'Janna');

    expect(AllSpells.Janna_R).toBe(Janna_R);
    expect(group?.spells).toContain(Janna_R);
  });

  it('knocks enemies back once then heals allies on channel ticks', () => {
    const added: unknown[] = [];
    const enemyBuffs: unknown[] = [];
    const enemy: TestUnit = {
      position: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      isDead: false,
      addBuff: buff => enemyBuffs.push(buff),
      takeHeal: vi.fn(),
    };
    const ally: TestUnit = {
      position: new TestVector(200, 0),
      collisionRadius: 20,
      teamId: 'blue',
      isDead: false,
      addBuff: vi.fn(),
      takeHeal: vi.fn(),
    };
    const owner: TestUnit & {
      game: {
        eventManager: { emit: ReturnType<typeof vi.fn> };
        objectManager: {
          addObject: (object: unknown) => void;
          queryObjects: () => TestUnit[];
        };
      };
      canCast: boolean;
      stats: { mana: { value: number }; health: { value: number } };
    } = {
      position: new TestVector(0, 0),
      collisionRadius: 20,
      teamId: 'blue',
      isDead: false,
      addBuff: vi.fn(),
      takeHeal: vi.fn(),
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: unknown) => added.push(object),
          queryObjects: () => [owner, ally, enemy],
        },
      },
      canCast: true,
      stats: { mana: { value: 100 }, health: { value: 100 } },
    };
    const spell = new Janna_R(owner);

    spell.press(context(owner));

    expect(spell.state).toBe('CHANNELING');
    expect(enemyBuffs).toHaveLength(1);
    const knockback = enemyBuffs[0] as {
      dashDestination: { x: number; y: number };
      dashSpeed: number;
    };
    expect(knockback.dashDestination).toEqual({ x: 875, y: 0 });
    expect(knockback.dashSpeed).toBeCloseTo(775 / 30);

    const area = added.find(object => object instanceof AreaSpellObject) as AreaSpellObject<TestUnit>;
    area.update(250);
    area.update(250);

    expect(ally.takeHeal).toHaveBeenCalledTimes(2);
    expect(ally.takeHeal).toHaveBeenLastCalledWith(2, owner);
    expect(enemy.takeHeal).not.toHaveBeenCalled();
  });

  it.each(['MOVE', 'STUN'] as const)('stops ticks and loop VFX when %s cancels it', reason => {
    const added: unknown[] = [];
    const owner: TestUnit & {
      game: {
        eventManager: { emit: ReturnType<typeof vi.fn> };
        objectManager: {
          addObject: (object: unknown) => void;
          queryObjects: () => TestUnit[];
        };
      };
      canCast: boolean;
      stats: { mana: { value: number }; health: { value: number } };
    } = {
      position: new TestVector(0, 0),
      collisionRadius: 20,
      teamId: 'blue',
      isDead: false,
      addBuff: vi.fn(),
      takeHeal: vi.fn(),
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: unknown) => added.push(object),
          queryObjects: () => [owner],
        },
      },
      canCast: true,
      stats: { mana: { value: 100 }, health: { value: 100 } },
    };
    const spell = new Janna_R(owner);

    spell.press(context(owner));
    const area = added.find(object => object instanceof AreaSpellObject) as AreaSpellObject<TestUnit>;

    expect(spell.cancel(reason)).toBe(true);
    area.update(250);

    expect(area.toRemove).toBe(true);
    expect(owner.takeHeal).not.toHaveBeenCalled();
    expect(loopDispose).toHaveBeenCalledOnce();
  });

  it('completes after its imported maximum channel duration', () => {
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: { addObject: vi.fn(), queryObjects: () => [] },
      },
      position: new TestVector(0, 0),
      collisionRadius: 20,
      teamId: 'blue',
      isDead: false,
      canCast: true,
      addBuff: vi.fn(),
      takeHeal: vi.fn(),
      stats: { mana: { value: 100 }, health: { value: 100 } },
    };
    const spell = new Janna_R(owner);

    spell.press(context(owner));
    vi.stubGlobal('deltaTime', 3_000);
    spell.update();

    expect(spell.state).toBe('COOLDOWN');
  });
});
