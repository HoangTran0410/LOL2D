import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Darius_Q, {
  BLADE_DAMAGE,
  HANDLE_DAMAGE,
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
import Dash from '../../../src/game/gameObject/buffs/Dash';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

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
