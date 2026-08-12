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

import EventManager from '../../../src/managers/EventManager';
import EventType from '../../../src/game/enums/EventType';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import Spell from '../../../src/game/gameObject/Spell';
import Ghost from '../../../src/game/gameObject/spells/Ghost';
import Heal from '../../../src/game/gameObject/spells/Heal';
import Ignite from '../../../src/game/gameObject/spells/Ignite';
import Janna_R from '../../../src/game/gameObject/spells/Janna_R';
import * as AllSpells from '../../../src/game/gameObject/spells/index';
import AreaSpellObject from '../../../src/game/gameObject/spellObjects/AreaSpellObject';
import { SpellGroups } from '../../../src/game/preset';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
}

interface TestUnit {
  position: TestVector;
  destination: TestVector;
  collisionRadius: number;
  teamId: string;
  isDead: boolean;
  canCast: boolean;
  stopMovement: () => void;
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

const makeOwner = (candidates: TestUnit[] = []) => {
  const added: unknown[] = [];
  const owner = {
    position: new TestVector(0, 0),
    destination: new TestVector(0, 0),
    collisionRadius: 20,
    teamId: 'blue',
    isDead: false,
    canCast: true,
    addBuff: vi.fn(),
    takeHeal: vi.fn(),
    stopMovement() { this.destination.set(this.position.x, this.position.y); },
    game: {
      eventManager: new EventManager(),
      terrainMap: { getObstaclesInArea: vi.fn(() => []) },
      objectManager: {
        addObject: (object: unknown) => added.push(object),
        queryObjects: () => [owner, ...candidates],
      },
    },
    stats: { mana: { value: 200 }, health: { value: 100 } },
  };
  return { owner, added };
};

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

  it('uses imported rank-one resource values', () => {
    const { owner } = makeOwner();
    const spell = new Janna_R(owner);

    spell.press(context(owner));

    expect(spell.coolDown).toBe(130_000);
    expect(spell.manaCost).toBe(100);
    expect(owner.stats.mana.value).toBe(100);
  });

  it('knocks enemies back once then heals allies on runtime channel ticks', () => {
    const enemyBuffs: unknown[] = [];
    const enemy: TestUnit = {
      position: new TestVector(100, 0),
      destination: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      isDead: false,
      canCast: true,
      stopMovement() { this.destination.set(this.position.x, this.position.y); },
      addBuff: buff => enemyBuffs.push(buff),
      takeHeal: vi.fn(),
    };
    const ally: TestUnit = {
      position: new TestVector(200, 0),
      destination: new TestVector(200, 0),
      collisionRadius: 20,
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement() { this.destination.set(this.position.x, this.position.y); },
      addBuff: vi.fn(),
      takeHeal: vi.fn(),
    };
    const { owner } = makeOwner([ally, enemy]);
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

    vi.stubGlobal('deltaTime', 250);
    spell.update();
    spell.update();

    expect(ally.takeHeal).toHaveBeenCalledTimes(2);
    expect(ally.takeHeal).toHaveBeenLastCalledWith(2, owner);
    expect(enemy.takeHeal).not.toHaveBeenCalled();
  });

  it.each([
    ['movement command', (owner: ReturnType<typeof makeOwner>['owner']) => owner.destination.set(10, 0)],
    ['displacement', (owner: ReturnType<typeof makeOwner>['owner']) => owner.position.set(10, 0)],
    ['cast-blocking CC', (owner: ReturnType<typeof makeOwner>['owner']) => { owner.canCast = false; }],
    ['another spell cast', (owner: ReturnType<typeof makeOwner>['owner']) => {
      owner.game.eventManager.emit(EventType.ON_POST_CAST_SPELL, { owner });
    }],
    ['an attack', (owner: ReturnType<typeof makeOwner>['owner']) => {
      owner.game.eventManager.emit(EventType.ON_ATTACK, owner);
    }],
  ] as const)('gameplay %s cancels ticks and loop VFX', (_name, interrupt) => {
    const { owner, added } = makeOwner();
    const spell = new Janna_R(owner);

    spell.press(context(owner));
    const area = added.find(object => object instanceof AreaSpellObject) as AreaSpellObject<TestUnit>;
    interrupt(owner);
    spell.update();

    expect(spell.state).toBe('COOLDOWN');
    expect(area.toRemove).toBe(true);
    expect(owner.takeHeal).not.toHaveBeenCalled();
    expect(loopDispose).toHaveBeenCalledOnce();
  });

  it('keeps channeling after rejected casts and imported-permitted summoner casts', () => {
    class RejectedSpell extends Spell {
      checkCastCondition(): boolean { return false; }
    }

    const { owner } = makeOwner();
    const spell = new Janna_R(owner);
    spell.press(context(owner));

    const rejected = new RejectedSpell(owner);
    expect(rejected.press(context(owner))).toBe(false);
    expect(spell.state).toBe('CHANNELING');

    for (const SummonerSpell of [Ghost, Heal, Ignite]) {
      const permitted = Object.assign(Object.create(SummonerSpell.prototype), { owner });
      owner.game.eventManager.emit(EventType.ON_POST_CAST_SPELL, permitted);
      expect(spell.state).toBe('CHANNELING');
    }
  });

  it('cancels only after a prohibited spell successfully casts', () => {
    class ProhibitedSpell extends Spell {}

    const { owner } = makeOwner();
    const spell = new Janna_R(owner);
    spell.press(context(owner));

    const prohibited = new ProhibitedSpell(owner);
    expect(prohibited.press(context(owner))).toBe(true);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('includes the twelfth heal tick at its imported maximum channel duration', () => {
    const ally: TestUnit = {
      position: new TestVector(200, 0),
      destination: new TestVector(200, 0),
      collisionRadius: 20,
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement() { this.destination.set(this.position.x, this.position.y); },
      addBuff: vi.fn(),
      takeHeal: vi.fn(),
    };
    const { owner } = makeOwner([ally]);
    const spell = new Janna_R(owner);

    spell.press(context(owner));
    vi.stubGlobal('deltaTime', 3_000);
    spell.update();

    expect(ally.takeHeal).toHaveBeenCalledTimes(12);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('clamps knockback before walls, suppresses actions, and freezes normal movement', () => {
    const enemyBuffs: unknown[] = [];
    const enemy: TestUnit = {
      position: new TestVector(100, 0),
      destination: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      isDead: false,
      canCast: true,
      stopMovement() { this.destination.set(this.position.x, this.position.y); },
      addBuff: buff => enemyBuffs.push(buff),
      takeHeal: vi.fn(),
    };
    const { owner } = makeOwner([enemy]);
    owner.game.terrainMap.getObstaclesInArea.mockReturnValue([{
      vertices: [
        { x: 400, y: -100 },
        { x: 500, y: -100 },
        { x: 500, y: 100 },
        { x: 400, y: 100 },
      ],
    }]);
    const spell = new Janna_R(owner);

    spell.press(context(owner));

    expect(enemyBuffs).toHaveLength(1);
    const knockback = enemyBuffs[0] as {
      activateBuff(): void;
      deactivateBuff(): void;
      dashDestination: TestVector;
      statusFlagsToEnable: number;
    };
    expect(knockback).toMatchObject({
      dashDestination: { x: 380, y: 0 },
    });
    expect(knockback.statusFlagsToEnable & StatusFlags.Immovable).toBeTruthy();
    expect(knockback.statusFlagsToEnable & StatusFlags.Silenced).toBeTruthy();
    expect(knockback.statusFlagsToEnable & StatusFlags.Ghosted).toBeFalsy();

    enemy.destination.set(999, 999);
    knockback.activateBuff();
    expect(enemy.destination).toEqual({ x: 100, y: 0 });

    knockback.deactivateBuff();
    expect(enemy.position).toEqual({ x: 380, y: 0 });
    expect(enemy.destination).toEqual({ x: 380, y: 0 });
  });
});
