import { PredefinedFilters, type GameObjectFilter } from '@/game/managers/ObjectManager';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Pet from '@/game/gameObject/attackableUnits/Pet';

/**
 * The two rules that make a global ultimate a global ultimate.
 *
 * Two of this pack's ultimates are the same shot with different art, and the
 * wiki says the same three things about both: range *Global*, speed rising
 * with time in the air, and payload scaling with the
 * distance it covered before it hit. Neither collides with anything but an
 * enemy champion — that is what lets them be fired down a lane full of minions
 * from the other side of the map.
 *
 * Stated here once so the pair cannot drift, and so the next one inherits it.
 */

/**
 * Bodies a global shot is allowed to hit: enemy champions, and nothing else.
 *
 * `Pet` extends `Champion`, so summons have to come back out explicitly or a
 * cross-map rocket would be swallowed by a Jack in the Box.
 */
export const enemyChampionsOnly = (teamId: string): readonly GameObjectFilter[] => [
  PredefinedFilters.canTakeDamageFromTeam(teamId),
  PredefinedFilters.type(Champion),
  PredefinedFilters.excludeType(Pet),
];

/**
 * 0 at the muzzle, 1 at `fullPowerAt`. Both ultimates ramp something over the
 * flight — one's damage from 10% to 100%, the other's stun from 1s to 3.5s —
 * and both mean "this is a shot you take from far away".
 */
export const travelRamp = (distanceTravelled: number, fullPowerAt: number): number =>
  Math.max(0, Math.min(1, distanceTravelled / fullPowerAt));

/**
 * A shot that speeds up the longer it is in the air, which is what stops a
 * cross-map ultimate from being a boring twenty-second wait at the far end.
 */
export const acceleratedSpeed = (
  distanceTravelled: number,
  from: number,
  to: number,
  fullSpeedAt: number
): number => from + (to - from) * travelRamp(distanceTravelled, fullSpeedAt);
