import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Darius_Q, {
  BLADE_DAMAGE,
  HANDLE_DAMAGE,
  HEAL_PERCENT_CHAMPION,
  HEAL_PERCENT_UNIT,
  HEMORRHAGE_MAX_STACKS,
  INNER_RADIUS,
  OUTER_RADIUS,
  applyHemorrhage,
  hemorrhageStacks,
} from '../../../src/game/gameObject/spells/Darius_Q';
import Darius_E, {
  CONE_RANGE,
  PULL_STOP_DISTANCE,
} from '../../../src/game/gameObject/spells/Darius_E';
import Darius_R, {
  BASE_DAMAGE,
  DAMAGE_PER_STACK,
} from '../../../src/game/gameObject/spells/Darius_R';
import { pickExecuteTarget } from '../../../src/game/combat/ExecuteTargeting';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

const makeMinion = (game: TestGame, x: number, y: number): Minion =>
  new Minion({
    game,
    teamId: 'red',
    position: createVector(x, y),
    waypoints: getLaneWaypoints(Lane.MID, 'red'),
    lane: Lane.MID,
  } as never);

const champion = (game: TestGame, x: number, y: number, teamId: string): AttackableUnit => {
  const unit = new Champion({ game, teamId } as never) as unknown as AttackableUnit;
  unit.position.set(x, y);
  return unit;
};

const context = (caster: AttackableUnit, direction: { x: number; y: number }): CastContext => ({
  spellId: 'darius-test',
  activationId: 'darius-test',
  startedAtMs: 0,
  caster,
  origin: { x: caster.position.x, y: caster.position.y },
  cursorWorld: {
    x: caster.position.x + direction.x * 100,
    y: caster.position.y + direction.y * 100,
  },
  direction,
});

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
});
afterEach(() => vi.unstubAllGlobals());

/**
 * The hole in the middle of Decimate is the ability. Standing on top of Darius
 * has to be *safer* than standing at arm's length, or the spell is just a
 * bigger circle and there is nothing to play against.
 */
describe('Darius Q pays the blade and the handle differently', () => {
  const swing = () => {
    const game = createGame();
    const darius = champion(game, 0, 0, 'blue');
    const bladed = champion(game, (INNER_RADIUS + OUTER_RADIUS) / 2, 0, 'red');
    const hugging = champion(game, INNER_RADIUS - 20, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [bladed, hugging]) as never;

    new Darius_Q(darius).onSpellCast();
    return { darius, bladed, hugging };
  };

  it('cuts the far one for the full blade and bleeds it', () => {
    const { bladed } = swing();
    expect(bladed.stats.maxHealth.value - bladed.stats.health.value).toBe(BLADE_DAMAGE);
    expect(hemorrhageStacks(bladed)).toBe(1);
  });

  it('gives the one under his feet only the handle, and no bleed', () => {
    const { hugging } = swing();
    expect(hugging.stats.maxHealth.value - hugging.stats.health.value).toBe(HANDLE_DAMAGE);
    expect(hemorrhageStacks(hugging)).toBe(0);
  });
});

/**
 * Hemorrhage is the only thing that makes the ultimate worth holding, so the
 * ceiling on it is the ceiling on Noxian Guillotine.
 */
describe('Hemorrhage stacks, caps, and prices the guillotine', () => {
  it('stops at the cap however many times he cuts', () => {
    const game = createGame();
    const darius = champion(game, 0, 0, 'blue');
    const victim = champion(game, 100, 0, 'red');

    for (let i = 0; i < HEMORRHAGE_MAX_STACKS + 4; i++) applyHemorrhage(darius, victim);

    expect(hemorrhageStacks(victim)).toBe(HEMORRHAGE_MAX_STACKS);
  });

  it('is exactly what the ultimate reads to price itself', () => {
    const game = createGame();
    const darius = champion(game, 0, 0, 'blue');
    const clean = champion(game, 100, 0, 'red');
    const bled = champion(game, 200, 0, 'red');
    for (let i = 0; i < HEMORRHAGE_MAX_STACKS; i++) applyHemorrhage(darius, bled);

    const guillotine = new Darius_R(darius);
    expect(guillotine.executeDamageAgainst(clean)).toBe(BASE_DAMAGE);
    expect(guillotine.executeDamageAgainst(bled)).toBe(
      BASE_DAMAGE + DAMAGE_PER_STACK * HEMORRHAGE_MAX_STACKS
    );
  });
});

/**
 * The ultimate is a last-hitting button, so it takes whoever *dies* to it — not
 * whoever happens to be standing nearest, which is the enemy you did not mean.
 */
describe('Darius R leaps at the one that dies, not the one that is close', () => {
  it('walks past the healthy body at his feet for the dying one further out', () => {
    const game = createGame();
    const darius = champion(game, 0, 0, 'blue');
    const healthy = champion(game, 80, 0, 'red');
    const dying = champion(game, 300, 0, 'red');
    dying.stats.health.baseValue = 4;
    game.objectManager.queryObjects = vi.fn(() => [healthy, dying]) as never;

    expect(pickExecuteTarget(new Darius_R(darius))).toBe(dying);
  });
});

/**
 * Apprehend is a wedge, not a circle: what he swept has to come in and what he
 * had his back to has to be left alone.
 */
describe('Darius E only hauls in what the wedge covered', () => {
  it('drags the enemy in front to arm’s length and leaves the one behind standing', () => {
    const game = createGame();
    const darius = champion(game, 0, 0, 'blue');
    const ahead = champion(game, CONE_RANGE * 0.6, 0, 'red');
    const behind = champion(game, -CONE_RANGE * 0.6, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [ahead, behind]) as never;

    new Darius_E(darius).onSpellCast(context(darius, { x: 1, y: 0 }));

    const haul = ahead.buffs.find(buff => buff instanceof Dash) as Dash | undefined;
    expect(haul?.dashDestination?.x).toBeCloseTo(PULL_STOP_DISTANCE, 5);
    expect(behind.buffs.some(buff => buff instanceof Dash)).toBe(false);
  });
});

/**
 * Decimate's sustain used to be a step per champion caught: a flat 10 whether
 * the swing took someone from full health or finished one sitting on 4, and
 * the same 10 whether the hit landed on flesh or was eaten whole by a shield.
 * It is a share of the damage actually dealt now, which is what makes all
 * three of those different numbers.
 */
describe('Darius Q heals for a share of the damage it lands', () => {
  /**
   * Low on purpose, so a heal has somewhere to go — but it is also the ceiling
   * every case here is measured against. `takeHeal` clamps to `maxHealth`, so
   * what this returns is `min(owed, CASTER_POOL - CASTER_START_HEALTH)`, and a
   * case that owes more than the headroom measures the clamp rather than the
   * rate. See the wave case at the bottom, which is now one of those.
   */
  const CASTER_START_HEALTH = 10;

  const swingAt = (victims: AttackableUnit[]) => {
    const game = createGame();
    const darius = champion(game, 0, 0, 'blue');
    darius.stats.health.baseValue = CASTER_START_HEALTH;
    game.objectManager.queryObjects = vi.fn(() => victims) as never;

    const before = darius.stats.health.baseValue;
    new Darius_Q(darius).onSpellCast();
    return darius.stats.health.baseValue - before;
  };

  /** Read off a champion rather than restated, so a retune of the pool cannot leave a stale 100 here. */
  const casterPool = (): number =>
    champion(createGame(), 0, 0, 'blue').stats.maxHealth.value;

  const bladeRange = (INNER_RADIUS + OUTER_RADIUS) / 2;

  it('takes its cut of the full blade against a healthy champion', () => {
    const game = createGame();
    const victim = champion(game, bladeRange, 0, 'red');
    expect(swingAt([victim])).toBe(Math.round(BLADE_DAMAGE * HEAL_PERCENT_CHAMPION));
  });

  it('heals far less off a champion who only had a sliver left', () => {
    const game = createGame();
    const dying = champion(game, bladeRange, 0, 'red');
    dying.stats.health.baseValue = 4;

    // 4 health there to take, so 4 damage dealt — not the 30 the blade swung
    // for. This is the case the old per-champion count could not express.
    expect(swingAt([dying])).toBe(Math.round(4 * HEAL_PERCENT_CHAMPION));
  });

  it('scales with the number of champions because it scales with the damage', () => {
    const game = createGame();
    const one = champion(game, bladeRange, 0, 'red');
    const two = champion(game, -bladeRange, 0, 'red');
    const three = champion(game, 0, bladeRange, 'red');
    // Parenthesised the way the ability adds it up — a share per victim, summed,
    // rounded once at the end. `3 * BLADE_DAMAGE * HEAL_PERCENT_CHAMPION`
    // associates the other way and is 31.499999999999996 rather than 31.5, so it
    // rounds to 31 and disagrees with correct code by one.
    expect(swingAt([one, two, three])).toBe(
      Math.round(3 * (BLADE_DAMAGE * HEAL_PERCENT_CHAMPION))
    );
  });

  it('pays the unit rate for minions, which is not the champion rate', () => {
    const game = createGame();
    // Two, not a wave. Six minions owe more heal than Darius has pool, so the
    // clamp would answer this and the rate would never be read — the wave case
    // below is that measurement, kept separate on purpose.
    const pair = [0, 1].map(index => makeMinion(game, bladeRange, index * 10));
    const healed = swingAt(pair as unknown as AttackableUnit[]);

    expect(healed).toBe(Math.round(2 * (BLADE_DAMAGE * HEAL_PERCENT_UNIT)));
    // Guards the branch, not just the arithmetic: the two rates are different
    // numbers, so landing on the unit one proves `victim instanceof Champion`
    // took the right side.
    expect(healed).not.toBe(Math.round(2 * (BLADE_DAMAGE * HEAL_PERCENT_CHAMPION)));
  });

  /**
   * The wave case, and what it says has reversed. `HEAL_PERCENT_UNIT` was the
   * *lower* of the two rates when this suite was written — the comment above
   * the constants still argues for that, calling the wave a trickle and warning
   * that one rate for both "would turn Decimate into a full heal on every wave".
   * At 0.7 against 0.5 it is now the higher one, and six blades owe 126 into a
   * 100 pool: the full heal the design was avoiding.
   *
   * Asserted as the clamp it is, rather than deleted or written as a rate the
   * caster can no longer express. If the tuning is meant to stand, this is what
   * it does; if it is not, this test fails the moment the rates go back.
   */
  it('a full wave now owes more heal than Darius has pool, so Decimate fills him', () => {
    const game = createGame();
    const wave = [0, 1, 2, 3, 4, 5].map(index => makeMinion(game, bladeRange, index * 10));
    const healed = swingAt(wave as unknown as AttackableUnit[]);

    const owed = 6 * (BLADE_DAMAGE * HEAL_PERCENT_UNIT);
    const pool = casterPool();
    expect(owed).toBeGreaterThan(pool);
    // Healed to full from wherever he was, and no further.
    expect(healed).toBe(pool - CASTER_START_HEALTH);
    // The rate really is the reason: at the champion rate the same wave would
    // have stayed inside the pool.
    expect(6 * (BLADE_DAMAGE * HEAL_PERCENT_CHAMPION)).toBeLessThanOrEqual(pool);
  });

  it('pays nothing for the one standing on his feet', () => {
    const game = createGame();
    const hugging = champion(game, INNER_RADIUS - 20, 0, 'red');
    expect(swingAt([hugging])).toBe(0);
  });
});
