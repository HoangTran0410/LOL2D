import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import ActionState from '../../../src/game/enums/ActionState';
import Spell from '../../../src/game/gameObject/Spell';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Game from '../../../src/game/Game';
import Ahri_Q from '../../../src/game/gameObject/spells/Ahri_Q';
import { Zed_W_Clone } from '../../../src/game/gameObject/spells/Zed_W';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  add(value: TestVector | number, y?: number) {
    this.x += typeof value === 'number' ? value : value.x;
    this.y += typeof value === 'number' ? (y ?? value) : value.y;
    return this;
  }
  sub(value: TestVector) { this.x -= value.x; this.y -= value.y; return this; }
  mult(value: number) { this.x *= value; this.y *= value; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  magSq() { return this.x * this.x + this.y * this.y; }
  setMag(value: number) {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  normalize() { return this.setMag(1); }
  limit(value: number) { return this.mag() > value ? this.setMag(value) : this; }
  dist(value: TestVector) { return Math.hypot(this.x - value.x, this.y - value.y); }
  heading() { return Math.atan2(this.y, this.x); }
  rotate(angle: number) {
    const x = this.x * Math.cos(angle) - this.y * Math.sin(angle);
    this.y = this.x * Math.sin(angle) + this.y * Math.cos(angle);
    this.x = x;
    return this;
  }
  static add(a: TestVector, b: TestVector) { return a.copy().add(b); }
  static sub(a: TestVector, b: TestVector) { return a.copy().sub(b); }
  static dist(a: TestVector, b: TestVector) { return a.dist(b); }
  static fromAngle(angle: number) { return new TestVector(Math.cos(angle), Math.sin(angle)); }
}

const castContext = (caster: unknown, cursorWorld = { x: 0, y: 10 }): CastContext =>
  Object.freeze({
    spellId: 'spell',
    activationId: 'activation',
    startedAtMs: 1,
    caster,
    origin: Object.freeze({ x: 0, y: 0 }),
    cursorWorld: Object.freeze({ ...cursorWorld }),
    direction: Object.freeze({ x: 0, y: 1 }),
  });

const gameWithMouse = (worldMouse = new TestVector(10, 0)) => ({
  worldMouse,
  eventManager: {
    emit: vi.fn(),
    on: vi.fn(),
    unsub: vi.fn(),
  },
  objectManager: { addObject: vi.fn() },
  mapSize: 6400,
});

const ownerFor = (game: ReturnType<typeof gameWithMouse>, id = 'owner') => ({
  id,
  game,
  position: new TestVector(0, 0),
  teamId: 'blue',
  isDead: false,
  canCast: true,
  stats: { mana: { value: 100 }, health: { value: 100 } },
});

const makeResourcesWritable = (unit: AIChampion | Zed_W_Clone) => {
  for (const resource of [unit.stats.mana, unit.stats.health]) {
    Object.defineProperty(resource, 'value', {
      configurable: true,
      get: () => resource.baseValue,
      set: (value: number) => { resource.baseValue = value; },
    });
  }
};

describe('spell aim integration', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('publishes an immutable context before pre-cast and returns fresh aim vectors', () => {
    const game = gameWithMouse();
    const owner = ownerFor(game);
    const spell = new Spell(owner);
    let contextSeenAtPreCast: CastContext | undefined;
    game.eventManager.emit.mockImplementation(() => {
      contextSeenAtPreCast = spell.castContext;
    });
    const mutableCursor = { x: 0, y: 10 };
    const context = { ...castContext(owner), cursorWorld: mutableCursor };

    spell.press(context);
    mutableCursor.y = 99;
    const firstAim = spell.aimPoint as unknown as TestVector;
    firstAim.y = 50;

    expect(contextSeenAtPreCast?.cursorWorld).toEqual({ x: 0, y: 10 });
    expect(Object.isFrozen(contextSeenAtPreCast)).toBe(true);
    expect(spell.aimPoint).toMatchObject({ x: 0, y: 10 });
    expect(spell.aimPoint).not.toBe(firstAim);
  });

  it('aims a legacy directed spell from CastContext instead of game.worldMouse', () => {
    const game = gameWithMouse();
    const owner = ownerFor(game);
    const spell = new Ahri_Q(owner);

    spell.press(castContext(owner));

    const missile = game.objectManager.addObject.mock.calls[0][0];
    expect(missile.destination.x).toBeCloseTo(0);
    expect(missile.destination.y).toBeCloseTo(350);
  });

  it('aims an AI press at its destination instead of game.worldMouse', () => {
    const game = gameWithMouse();
    const ai = new AIChampion({
      game,
      position: new TestVector(0, 0) as any,
      teamId: 'red',
      preset: { spells: [] },
    });
    makeResourcesWritable(ai);
    ai.destination = new TestVector(0, 20) as any;
    ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
    class AimSpell extends Spell {
      usedAim?: p5.Vector;
      onSpellCast() { this.usedAim = this.aimPoint; }
    }
    const spell = new AimSpell(ai);
    ai.spells = [spell];
    vi.stubGlobal('random', vi.fn(() => 0));

    ai.update();

    expect(spell.usedAim).toMatchObject({ x: 0, y: 20 });
  });

  it.each(['HOLD_RELEASE', 'TAP_OR_HOLD'] as const)(
    'releases AI %s casts at a deterministic charge instead of timing out',
    activation => {
      const game = gameWithMouse();
      const ai = new AIChampion({
        game,
        position: new TestVector(0, 0) as any,
        teamId: 'red',
        preset: { spells: [] },
      });
      makeResourcesWritable(ai);
      ai.destination = new TestVector(0, 20) as any;
      ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
      class ChargedSpell extends Spell {
        releases = 0;
        get castSpec() {
          return {
            activation,
            targeting: 'DIRECTION' as const,
            charge: { maxDurationMs: 100, releaseAtMax: false },
            resource: { commitAt: 'start' as const, refundOn: [] },
            cooldown: { startAt: 'end' as const, durationMs: 0 },
            interrupts: { move: false },
          };
        }
        onRelease() { this.releases += 1; }
      }
      const spell = new ChargedSpell(ai);
      ai.spells = [spell];
      vi.stubGlobal('random', vi.fn(() => 0));
      vi.stubGlobal('deltaTime', 50);

      ai.update();
      expect(spell.state).toBe('CHARGING');
      ai.update();
      expect(spell.releases).toBe(1);
    }
  );

  it('aims an AI UNIT cast at an eligible unit instead of its move destination', () => {
    const untargetable = {
      position: new TestVector(50, 0), collisionRadius: 25,
      teamId: 'blue', targetable: false,
    };
    const target = {
      position: new TestVector(100, 0), collisionRadius: 25,
      teamId: 'blue', targetable: true,
    };
    const game = Object.assign(gameWithMouse(), {
      objectManager: { objects: [untargetable, target], addObject: vi.fn() },
      createSpellContext: Game.prototype.createSpellContext,
    });
    const ai = new AIChampion({
      game, position: new TestVector(0, 0) as any, teamId: 'red', preset: { spells: [] },
    });
    makeResourcesWritable(ai);
    ai.destination = new TestVector(0, 500) as any;
    ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
    class UnitSpell extends Spell {
      usedTarget?: unknown;
      get castSpec() { return {
        activation: 'PRESS' as const, targeting: 'UNIT' as const,
        resource: { commitAt: 'start' as const, refundOn: [] },
        cooldown: { startAt: 'start' as const, durationMs: 0 },
      }; }
      get targetingRequest() { return {
        range: 500, targetTeam: 'ENEMY' as const,
      }; }
      onSpellCast(context: CastContext) { this.usedTarget = context.target; }
    }
    const spell = new UnitSpell(ai);
    ai.spells = [spell];
    vi.stubGlobal('random', vi.fn(() => 0));

    ai.update();

    expect(spell.usedTarget).toBe(target);
  });

  it('creates player contexts from the actual spell targeting mode', () => {
    const caster = ownerFor(gameWithMouse(new TestVector(100, 0)));
    const target = {
      position: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      targetable: true,
    };
    class UnitSpell extends Spell {
      get castSpec() {
        return {
          activation: 'PRESS' as const,
          targeting: 'UNIT' as const,
          resource: { commitAt: 'start' as const, refundOn: [] },
          cooldown: { startAt: 'start' as const, durationMs: 0 },
        };
      }
      get targetingRequest() { return { range: 500, targetTeam: 'ENEMY' as const }; }
    }
    const game = Object.assign(Object.create(Game.prototype), {
      worldMouse: new TestVector(100, 0),
      objectManager: { objects: [target] },
    }) as Game;
    const spell = new UnitSpell(caster);

    expect(game.createSpellContext(spell, caster, game.worldMouse)).toMatchObject({ target });
    game.worldMouse.x = 200;
    expect(game.createSpellContext(spell, caster, game.worldMouse)).toBeUndefined();
  });

  it('replays a pending Zed shadow cast without mutating worldMouse', () => {
    const worldMouse = new TestVector(10, 0);
    const game = gameWithMouse(worldMouse);
    const owner = ownerFor(game);
    class MirroredSpell extends Spell {
      usedContext?: CastContext;
      onSpellCast(context: CastContext) { this.usedContext = context; }
    }
    const source = new MirroredSpell(owner);
    source.press(castContext(owner));

    const clone = new Zed_W_Clone({
      game,
      position: new TestVector(5, 5),
      teamId: 'blue',
    } as any);
    makeResourcesWritable(clone);
    clone.owner = owner;
    clone.onSomeOnePreCastSpell(source);
    clone.onAdded();
    const dash = clone.buffs[clone.buffs.length - 1];
    dash.onReachedDestination();

    const replay = clone._mapSpells[source.id].clone as MirroredSpell;
    expect(game.worldMouse).toBe(worldMouse);
    expect(replay.usedContext?.cursorWorld).toEqual({ x: 0, y: 10 });
    expect(replay.usedContext?.origin).toEqual({ x: 5, y: 5 });
    expect(replay.usedContext?.caster).toBe(clone);
    expect(replay.usedContext?.direction.x).toBeCloseTo(-Math.SQRT1_2);
    expect(replay.usedContext?.direction.y).toBeCloseTo(Math.SQRT1_2);

    const coincidentReplay = new MirroredSpell(clone);
    clone.pressClone(coincidentReplay, castContext(owner, { x: 5, y: 5 }));
    expect(coincidentReplay.usedContext?.direction).toEqual({ x: 0, y: 0 });
  });

  it('keeps shared worldMouse out of spell activation code', () => {
    const spellsDir = fileURLToPath(
      new URL('../../../src/game/gameObject/spells/', import.meta.url)
    );
    const reads = readdirSync(spellsDir)
      .filter(file => file.endsWith('.ts'))
      .flatMap(file =>
        readFileSync(`${spellsDir}/${file}`, 'utf8')
          .split('\n')
          .filter(line => line.includes('this.game.worldMouse'))
          .map(line => `${file}:${line.trim()}`)
      );

    expect(reads).toEqual([
      'Blitzcrank_E.ts:const angle = VectorUtils.getAngle(this.owner.position, this.game.worldMouse);',
    ]);
  });
});
