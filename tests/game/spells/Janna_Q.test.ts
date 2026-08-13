import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Janna_Q, { Janna_Q_Object } from '../../../src/game/gameObject/spells/Janna_Q';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}

  copy(): TestVector { return new TestVector(this.x, this.y); }
  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  add(vector: TestVector): this { this.x += vector.x; this.y += vector.y; return this; }
  mult(value: number): this { this.x *= value; this.y *= value; return this; }
  dist(vector: TestVector): number { return Math.hypot(this.x - vector.x, this.y - vector.y); }
}

const context = (
  caster: unknown,
  origin: { x: number; y: number },
  cursorWorld: { x: number; y: number },
  direction: { x: number; y: number }
): CastContext =>
  Object.freeze({
    spellId: 'janna-q',
    activationId: 'activation',
    startedAtMs: 0,
    caster,
    origin: Object.freeze(origin),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze(direction),
  });

const setup = () => {
  const game = {
    worldMouse: new TestVector(110, 20),
    eventManager: { emit: vi.fn() },
    objectManager: { addObject: vi.fn() },
  };
  const owner = {
    game,
    position: new TestVector(10, 20),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    stats: { mana: { value: 100 }, health: { value: 100 } },
  };
  const spell = new Janna_Q(owner);
  const firstContext = context(owner, { x: 10, y: 20 }, { x: 110, y: 20 }, { x: 1, y: 0 });

  spell.press(firstContext);
  const tornado = game.objectManager.addObject.mock.calls[0]?.[0] as Janna_Q_Object;
  return { firstContext, game, owner, spell, tornado };
};

describe('Janna Q', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('spawns at the first-cast position and snapshots first-cast direction', () => {
    const { owner, spell, tornado } = setup();
    owner.position.set(40, 60);

    spell.press(context(owner, { x: 40, y: 60 }, { x: 40, y: 160 }, { x: 0, y: 1 }));

    expect(tornado.position).toMatchObject({ x: 10, y: 20 });
    expect(tornado.destination).toMatchObject({ x: 536, y: 20 });
  });

  it('allows Janna to move and cast while the tornado remains ACTIVE', () => {
    const { spell, tornado } = setup();

    expect(spell.state).toBe('ACTIVE');
    expect(spell.cancel('MOVE')).toBe(false);
    expect(tornado.charging).toBe(true);
  });

  it('ignores physical Q release', () => {
    const { firstContext, spell, tornado } = setup();

    expect(spell.release(firstContext)).toBe(false);
    expect(spell.state).toBe('ACTIVE');
    expect(tornado.charging).toBe(true);
  });

  it('releases on second Q press', () => {
    const { owner, spell, tornado } = setup();

    expect(spell.press(context(owner, { x: 10, y: 20 }, { x: 10, y: 120 }, { x: 0, y: 1 }))).toBe(true);

    expect(tornado.charging).toBe(false);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('auto-releases at maximum active charge duration', () => {
    const { spell, tornado } = setup();
    vi.stubGlobal('deltaTime', 3_000);

    spell.update();

    expect(tornado.charging).toBe(false);
    expect(tornado.chargeRatio).toBe(1);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('scales range speed damage and knockup from the stored charge ratio', () => {
    const { tornado } = setup();
    tornado.chargeTime = 1_500;

    tornado.release();

    expect(tornado.destination).toMatchObject({ x: 705, y: 20 });
    expect(tornado.speed).toBeCloseTo(1_144 / 60);
    expect(tornado.size).toBe(60);
    expect(tornado.getCurrentDamage()).toBe(23);
    expect(tornado.getCurrentAirborneTime()).toBe(875);
  });

  it('uses imported rank-one cooldown, mana, edge range, and speed', () => {
    const { spell, tornado } = setup();

    expect(spell.coolDown).toBe(5_000);
    expect(spell.manaCost).toBe(90);
    expect(spell.minRange).toBe(550);
    expect(spell.maxRange).toBe(900);
    expect(tornado.minSize).toBe(48);
    expect(tornado.maxSize).toBe(72);
    expect(tornado.minSpeed).toBeCloseTo(880 / 60);
    expect(tornado.maxSpeed).toBeCloseTo(1_408 / 60);
  });

  it('cleans up and starts cooldown once on caster death', () => {
    const { owner, spell, tornado } = setup();
    owner.isDead = true;

    spell.update();
    const cooldownAfterDeath = spell.currentCooldown;
    spell.update();

    expect(tornado.toRemove).toBe(true);
    expect(spell.state).toBe('COOLDOWN');
    expect(cooldownAfterDeath).toBeLessThan(spell.coolDown);
    expect(spell.currentCooldown).toBe(cooldownAfterDeath - 16);
  });
});
