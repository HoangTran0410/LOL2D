import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import StatusFlags from '../../../src/game/enums/StatusFlags';
import { createGame, createUnit } from '../spell/fixtures';
import { MAX_UNIT_SIZE } from '../../../src/game/gameObject/Stats';
import { TestVector } from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { BALL_SIZE_RATIO, FALLBACK_BODY_SIZE } from '../../../packs/riot/spells/Rammus_Q';
import { makeRammus_Q_Object, makeRammus_Q_Powerball } from '../../../packs/riot/spells/Rammus_Q';
const __api = buildContentApi();
const Rammus_Q_Object = makeRammus_Q_Object(__api);
const Rammus_Q_Powerball = makeRammus_Q_Powerball(__api);

const caster = (bodySize: number) => ({
  position: new TestVector(0, 0),
  teamId: 'blue',
  isDead: false,
  deathData: null,
  animatedValues: { displaySize: bodySize },
  bodyRadius: bodySize / 2,
  collisionRadius: 25,
  game: { objectManager: { addObject: vi.fn(), queryObjects: vi.fn(() => []) } },
});

const victim = (bodySize: number, distance: number) => ({
  position: new TestVector(distance, 0),
  bodyRadius: bodySize / 2,
  collisionRadius: 25,
});

describe('Rammus Q ball size', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('tracks the caster body instead of a fixed number', () => {
    const small = new Rammus_Q_Object(caster(55) as never);
    const grown = new Rammus_Q_Object(caster(MAX_UNIT_SIZE) as never);

    expect(small.size).toBe(55 * BALL_SIZE_RATIO);
    expect(grown.size).toBe(MAX_UNIT_SIZE * BALL_SIZE_RATIO);
    expect(grown.size).toBeGreaterThan(small.size * 2);
  });

  it('falls back to a champion body before the caster has an animated size', () => {
    const owner = caster(55) as unknown as { animatedValues?: unknown };
    owner.animatedValues = undefined;

    expect(new Rammus_Q_Object(owner as never).size).toBe(FALLBACK_BODY_SIZE * BALL_SIZE_RATIO);
  });

  // The actual bug: body separation holds two units at least
  // bodyRadius + bodyRadius apart, so a hit circle measured from the ball's
  // centre alone could never span the gap and the ball hit nobody at all.
  it('reaches past the gap body separation enforces', () => {
    const ball = new Rammus_Q_Object(caster(55) as never);
    const enemy = victim(55, 55); // exactly where separation parks two champions

    expect(ball.reachTo(enemy)).toBeGreaterThan(55);
  });

  it('still reaches when the caster has grown and the enemy has not', () => {
    const ball = new Rammus_Q_Object(caster(MAX_UNIT_SIZE) as never);
    const enemy = victim(55, MAX_UNIT_SIZE / 2 + 55 / 2);

    expect(ball.reachTo(enemy)).toBeGreaterThan(MAX_UNIT_SIZE / 2 + 55 / 2);
  });

  it('measures reach against a body radius, falling back to the collision radius', () => {
    const ball = new Rammus_Q_Object(caster(55) as never);

    expect(ball.reachTo({ collisionRadius: 25 })).toBe(ball.size / 2 + 25);
    expect(ball.reachTo({ bodyRadius: 90, collisionRadius: 25 })).toBe(ball.size / 2 + 90);
  });
});

// The repo owner's rule: curled into a ball he cannot swing. In the real game
// that is a restriction on attacking, not a channel — casting and Flash keep
// working — so it needs nothing beyond the Disarmed flag basic attacks added.
describe('Rammus Q disarms while rolling', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('raises Disarmed and nothing that would stop a cast or a blink', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const flags = new Rammus_Q_Powerball(4_000, unit, unit).statusFlagsToEnable;

    expect(flags & StatusFlags.Disarmed).toBe(StatusFlags.Disarmed);
    expect(flags & StatusFlags.Silenced).toBe(0);
    expect(flags & StatusFlags.Stunned).toBe(0);
    expect(flags & StatusFlags.Grounded).toBe(0);
  });

  it('takes attacking away from a real unit and leaves moving and casting', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const roll = new Rammus_Q_Powerball(4_000, unit, unit);

    unit.addBuff(roll);
    unit.updateBuffs();

    expect(unit.canAttack).toBe(false);
    expect(unit.canCast).toBe(true);
    expect(unit.canMove).toBe(true);

    roll.deactivateBuff();
    unit.updateBuffs();
    expect(unit.canAttack).toBe(true);
  });
});
