import { Circle } from '../../libs/quadtree';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '../managers/ObjectManager';
import type GameObject from '../gameObject/GameObject';
import type { Vec2 } from '../spell/runtime/types';

/**
 * Target acquisition for an attack *order* — as opposed to the delivery in
 * BasicAttack.ts and the standing order in BasicAttackController.ts.
 *
 * Right click already picks the body under the cursor
 * (Game.findAttackTargetUnderCursor). This is the keyboard half: the nearest
 * enemy to the cursor rather than to the champion, so the gesture is "point
 * roughly at him and press" instead of "hit a 55-pixel circle".
 */

/**
 * How far from the cursor a press reaches for a target, in world units.
 *
 * 250 sits just under the 300 default attack range and is about four and a half
 * champion bodies wide. It is measured from the *cursor*, and the nearest
 * candidate inside it wins, so a wider circle only decides anything when there
 * is nothing closer: it makes aiming forgiving without making it vague. Wider
 * than the attack range would be worse than useless — the order would resolve
 * onto someone the champion then has to walk to.
 */
export const CURSOR_ACQUISITION_RADIUS = 250;

const distanceTo = (point: Vec2, unit: AttackableUnit): number =>
  Math.hypot(unit.position.x - point.x, unit.position.y - point.y);

/**
 * The attackable enemy nearest `point`, or null when the neighbourhood is empty.
 *
 * Three rules, all of them the rules the right click path already plays by:
 *
 * - hostile, alive and targetable — `canTakeDamageFromTeam` covers all three,
 *   and it drops the attacker itself along the way, because every champion
 *   carries its own team id;
 * - visible — `willDraw` is the fog of war's own flag, so an order cannot be
 *   given onto something that cannot be seen, the same refusal a right click
 *   into the fog gets;
 * - nearest to the *cursor*, not to the attacker.
 *
 * Empty is a normal answer rather than a failure: `BasicAttackController.order`
 * ignores a null, so a press into open ground costs nothing and leaves a
 * standing order running.
 */
export function findAttackTargetNearPoint(
  attacker: AttackableUnit,
  point: Vec2,
  radius: number = CURSOR_ACQUISITION_RADIUS
): AttackableUnit | null {
  // optional call for the same reason AIChampion.findAttackTarget uses one:
  // spell tests hand in an object manager stub that only collects added objects
  const found =
    attacker.game?.objectManager?.queryObjects?.({
      area: new Circle({ x: point.x, y: point.y, r: radius }),
      // The radius below is measured centre to cursor. Leaving the implicit
      // surface-collision filter on would stack a second, looser test on top of
      // it and quietly widen the circle by a body radius.
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.canTakeDamageFromTeam(attacker.teamId),
        (object: GameObject) => object.willDraw,
      ],
    }) ?? [];

  let nearest: AttackableUnit | null = null;
  let nearestDistance = Infinity;
  for (const unit of found) {
    if (unit === attacker) continue;
    const distance = distanceTo(point, unit);
    if (distance > radius || distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = unit;
  }
  return nearest;
}
