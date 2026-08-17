import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Janna_Q, {
  Janna_Q_Object,
  MAX_AIRBORNE_MS,
  MAX_CHARGE_MS,
  MAX_DAMAGE,
  MAX_RANGE,
  MAX_SIZE,
  MAX_SPEED,
  MIN_AIRBORNE_MS,
  MIN_DAMAGE,
  MIN_RANGE,
  MIN_SIZE,
  MIN_SPEED,
} from '../../../src/game/gameObject/spells/Janna_Q';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}

  copy(): TestVector {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  add(vector: TestVector): this {
    this.x += vector.x;
    this.y += vector.y;
    return this;
  }
  mult(value: number): this {
    this.x *= value;
    this.y *= value;
    return this;
  }
  dist(vector: TestVector): number {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
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
    status: StatusFlags.None,
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
    expect(tornado.destination).toMatchObject({ x: 10 + MIN_RANGE, y: 20 });
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

    expect(spell.press(context(owner, { x: 10, y: 20 }, { x: 10, y: 120 }, { x: 0, y: 1 }))).toBe(
      true
    );

    expect(tornado.charging).toBe(false);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('auto-releases at maximum active charge duration', () => {
    const { spell, tornado } = setup();
    vi.stubGlobal('deltaTime', MAX_CHARGE_MS);

    spell.update();

    expect(tornado.charging).toBe(false);
    expect(tornado.chargeRatio).toBe(1);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('scales range speed damage and knockup from the stored charge ratio', () => {
    const { tornado } = setup();
    const ratio = 0.5;
    tornado.chargeTime = MAX_CHARGE_MS * ratio;

    tornado.release();

    expect(tornado.destination).toMatchObject({
      x: 10 + MIN_RANGE + (MAX_RANGE - MIN_RANGE) * ratio,
      y: 20,
    });
    expect(tornado.speed).toBeCloseTo(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * ratio);
    expect(tornado.size).toBe(MIN_SIZE + (MAX_SIZE - MIN_SIZE) * ratio);
    expect(tornado.getCurrentDamage()).toBe(
      Math.round(MIN_DAMAGE + (MAX_DAMAGE - MIN_DAMAGE) * ratio)
    );
    expect(tornado.getCurrentAirborneTime()).toBe(
      Math.round(MIN_AIRBORNE_MS + (MAX_AIRBORNE_MS - MIN_AIRBORNE_MS) * ratio)
    );
  });

  it('copies its declared range and charge window onto the tornado, and spends mana on cast', () => {
    const { owner, spell, tornado } = setup();

    expect(tornado.minRange).toBe(spell.minRange);
    expect(tornado.maxRange).toBe(spell.maxRange);
    expect(tornado.maxChargeTime).toBe(spell.maxChargeTime);
    expect(owner.stats.mana.value).toBe(100 - spell.manaCost);
  });

  // The funnel is already standing in the world by this point and fires itself
  // at full charge, so nothing Janna suffers should delete it. A charged cast
  // she is physically holding — Varus Q, Pantheon Q — is the opposite case and
  // keeps cancelling.
  it.each([
    [
      'stun',
      (o: { status: number }) => {
        o.status = StatusFlags.Stunned;
      },
    ],
    [
      'suppression',
      (o: { status: number }) => {
        o.status = StatusFlags.Suppressed;
      },
    ],
    [
      'silence',
      (o: { status: number }) => {
        o.status = StatusFlags.Silenced;
      },
    ],
    [
      'a cast-inhibiting state',
      (o: { canCast: boolean }) => {
        o.canCast = false;
      },
    ],
  ])('keeps the tornado alive through %s on the caster', (_name, applyCrowdControl) => {
    const { owner, spell, tornado } = setup();

    applyCrowdControl(owner as never);
    spell.update();

    expect(spell.state).toBe('ACTIVE');
    expect(tornado.toRemove).toBe(false);
    expect(tornado.charging).toBe(true);
  });

  it('still charges toward its own auto-release while the caster is stunned', () => {
    const { owner, spell, tornado } = setup();
    (owner as { status: number }).status = StatusFlags.Stunned;

    vi.stubGlobal('deltaTime', MAX_CHARGE_MS + 1);
    spell.update();

    expect(spell.state).toBe('COOLDOWN');
    expect(tornado.charging).toBe(false);
    expect(tornado.toRemove).toBe(false);
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
