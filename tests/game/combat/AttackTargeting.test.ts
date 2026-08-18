import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import ActionState from '../../../src/game/enums/ActionState';
import {
  findAttackTargetAlongRay,
  findAttackTargetNearPoint,
} from '../../../src/game/combat/AttackTargeting';
import { createGame, indexObjects, stubGameGlobals } from '../fixtures';

const target = (x: number, y: number, health = 100) =>
  ({
    position: { x, y },
    stats: { health: { value: health } },
    animatedValues: { displaySize: 54 },
  }) as unknown as AttackableUnit;

const attackerWith = (targets: AttackableUnit[]) =>
  ({
    position: { x: 0, y: 0 },
    teamId: 1,
    game: { objectManager: { queryObjects: () => targets } },
  }) as unknown as AttackableUnit;

const stealthedCombatants = () => {
  const game = createGame();
  const attacker = new AttackableUnit({
    game,
    position: createVector(0, 0),
    teamId: 'team-blue',
  });
  const hidden = new AttackableUnit({
    game,
    position: createVector(120, 0),
    teamId: 'team-red',
  });
  hidden.stats.setActionState(ActionState.STEALTHED, true);
  game.setPlayer(attacker);
  indexObjects(game, [attacker, hidden]);
  return { attacker, hidden };
};

describe('touch attack targeting', () => {
  beforeEach(() => {
    stubGameGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('locks a target near the aim ray instead of requiring the exact endpoint', () => {
    const intended = target(420, 55);
    const attacker = attackerWith([intended]);

    expect(findAttackTargetAlongRay(attacker, { x: 800, y: 0 }, 120)).toBe(intended);
  });

  it('ignores a target outside the aim cone', () => {
    const offAxis = target(350, 260);
    const attacker = attackerWith([offAxis]);

    expect(findAttackTargetAlongRay(attacker, { x: 800, y: 0 }, 120)).toBeNull();
  });

  it('keeps the previous target inside a wider release cone', () => {
    const previous = target(500, 135);
    const challenger = target(500, 100);
    const attacker = attackerWith([previous, challenger]);

    expect(findAttackTargetAlongRay(attacker, { x: 800, y: 0 }, 110, previous)).toBe(previous);
  });

  it('releases the previous target when the thumb clearly turns toward another enemy', () => {
    const previous = target(0, 180);
    const intended = target(500, 40);
    const attacker = attackerWith([previous, intended]);

    expect(findAttackTargetAlongRay(attacker, { x: 800, y: 0 }, 220, previous)).toBe(intended);
  });

  it('uses nearest by default and lowest health only when selected', () => {
    const nearest = target(100, 0, 90);
    const weak = target(180, 0, 10);
    const attacker = attackerWith([nearest, weak]);

    expect(findAttackTargetNearPoint(attacker, attacker.position, 300)).toBe(nearest);
    expect(findAttackTargetNearPoint(attacker, attacker.position, 300, 'lowest-health')).toBe(weak);
  });

  it('does not acquire a stealthed target near the attack-move point', () => {
    const { attacker, hidden } = stealthedCombatants();

    expect(hidden.isStealthed).toBe(true);
    expect(findAttackTargetNearPoint(attacker, hidden.position, 300)).toBeNull();
  });

  it('does not acquire a stealthed target along the touch aim ray', () => {
    const { attacker, hidden } = stealthedCombatants();

    expect(hidden.isStealthed).toBe(true);
    expect(findAttackTargetAlongRay(attacker, { x: 800, y: 0 }, 120)).toBeNull();
  });
});
