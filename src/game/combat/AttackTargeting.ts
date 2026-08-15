import { Circle } from '../../libs/quadtree';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '../managers/ObjectManager';
import type GameObject from '../gameObject/GameObject';
import type { Vec2 } from '../spell/runtime/types';

/**
 * Target acquisition for an attack *order* — as opposed to the delivery in
 * BasicAttack.ts and the standing order in BasicAttackController.ts.
 *
 * This is the only way an attack order is issued now. Right click used to also
 * pick the body directly under the cursor, which meant a move order and an
 * attack order shared one gesture and the game guessed between them; that guess
 * is gone. The rule here is the nearest enemy to the cursor rather than to the
 * champion, so the gesture is "point roughly at him and press" instead of "hit
 * a 55-pixel circle".
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

export type AttackTargetPriority = 'nearest' | 'lowest-health';

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
  radius: number = CURSOR_ACQUISITION_RADIUS,
  priority: AttackTargetPriority = 'nearest'
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
  let lowestHealth = Infinity;
  for (const unit of found) {
    if (unit === attacker) continue;
    const distance = distanceTo(point, unit);
    if (distance > radius) continue;
    const health = unit.stats?.health?.value ?? Infinity;
    if (
      priority === 'lowest-health' &&
      (health > lowestHealth || (health === lowestHealth && distance >= nearestDistance))
    ) {
      continue;
    }
    if (priority === 'nearest' && distance >= nearestDistance) continue;
    lowestHealth = health;
    nearestDistance = distance;
    nearest = unit;
  }
  return nearest;
}

/**
 * The hostile body closest to a thumb's aim ray. A short drag therefore says
 * "that direction" instead of forcing the player to also encode the target's
 * exact distance in a few centimetres of glass.
 */
export function findAttackTargetAlongRay(
  attacker: AttackableUnit,
  endpoint: Vec2,
  snapRadius: number,
  preferred: AttackableUnit | null = null
): AttackableUnit | null {
  const dx = endpoint.x - attacker.position.x;
  const dy = endpoint.y - attacker.position.y;
  const reach = Math.hypot(dx, dy);
  if (reach === 0) return null;
  const ux = dx / reach;
  const uy = dy / reach;
  const aimSlope = Math.max(snapRadius / reach, Math.tan((28 * Math.PI) / 180));
  const stickySlope = Math.max(aimSlope * 1.25, Math.tan((38 * Math.PI) / 180));
  const found =
    attacker.game?.objectManager?.queryObjects?.({
      area: new Circle({ x: attacker.position.x, y: attacker.position.y, r: reach }),
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.canTakeDamageFromTeam(attacker.teamId),
        (object: GameObject) => object.willDraw,
      ],
    }) ?? [];

  let sticky: AttackableUnit | null = null;
  let best: AttackableUnit | null = null;
  let bestAngle = Infinity;
  let bestDistance = Infinity;
  for (const unit of found) {
    if (unit === attacker) continue;
    const rx = unit.position.x - attacker.position.x;
    const ry = unit.position.y - attacker.position.y;
    const distance = Math.hypot(rx, ry);
    const along = rx * ux + ry * uy;
    const perpendicular = Math.abs(rx * uy - ry * ux);
    const bodyRadius = (unit.animatedValues?.displaySize ?? 0) / 2;
    const limit = bodyRadius + Math.max(0, along) * (unit === preferred ? stickySlope : aimSlope);
    if (along < -bodyRadius || along > reach + bodyRadius || perpendicular > limit) continue;
    if (unit === preferred) sticky = unit;

    const angle = perpendicular / Math.max(1, distance);
    if (angle > bestAngle || (angle === bestAngle && distance >= bestDistance)) continue;
    bestAngle = angle;
    bestDistance = distance;
    best = unit;
  }
  return sticky ?? best;
}
