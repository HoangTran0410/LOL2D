import { Circle } from '@/libs/quadtree';
import { vecDist } from '@/utils/math.utils';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * Target acquisition for an attack *order* — as opposed to the delivery in
 * BasicAttack.ts and the standing order in BasicAttackController.ts.
 *
 * The attack-move (`A`) acquisition path. Right click has its own exact body
 * hit-test in `input/PointerOrders.ts`; this path is deliberately more forgiving:
 * nearest enemy to the cursor rather than only the body directly underneath it.
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

/**
 * How far past its own reach a champion looks when the cursor found nobody.
 *
 * The cursor is not where the enemy is. It is where the player is *going* —
 * right click moves, every skillshot aims through it — and while kiting it
 * points the opposite way from the thing chasing you. Acquisition measured only
 * from the cursor therefore made the attack key unusable in exactly the moment
 * it matters: turn to shoot and you have to sweep the mouse back across the
 * fight, which is the same mouse you need pointed away to keep running.
 *
 * So a press that finds nothing under the cursor falls back to the nearest
 * visible enemy to the champion. This margin is what "nearest" is allowed to
 * cost: reach plus a step and a half, so the fallback can turn and fire at
 * something already on top of you but can never *start* a chase across open
 * ground. Widen it and the attack key becomes a charge command — the failure
 * mode a kiting player can least afford.
 */
export const FALLBACK_CHASE_MARGIN = 150;

export type AttackTargetPriority = 'nearest' | 'lowest-health';

const distanceTo = (point: Vec2, unit: AttackableUnit): number => vecDist(point, unit.position);

/**
 * The attackable enemy nearest `point`, or null when the neighbourhood is empty.
 *
 * Three rules shared with the exact right-click path:
 *
 * - hostile, alive and targetable — `canTakeDamageFromTeam` covers all three,
 *   and it drops the attacker itself along the way, because every champion
 *   carries its own team id;
 * - visible and not actively stealthed — `excludeStealthed` handles ability
 *   stealth while `visibleTo` handles terrain/fog sight. An order cannot be
 *   given onto something that cannot be seen, the same refusal a right click
 *   into the fog gets. This used to read `willDraw`,
 *   which is the fog's own flag and therefore answers one question only: is it
 *   lit *for the player*. `FogOfWar.calculateSight` clears the flag on every
 *   unit and re-lights it from `game.player.teamId`'s eyes, so a bot's attack
 *   order was gated on the player's vision — a bot could not order onto an
 *   enemy standing next to it in a bush the player happened not to see, and
 *   could order onto one across the map that the player did. It is also a
 *   *draw* flag, so it says nothing at all until the first frame is painted.
 *   `visibleTo` asks `combat/Vision.ts` on the attacker's own behalf;
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
        PredefinedFilters.excludeStealthed,
        PredefinedFilters.visibleTo(attacker),
      ],
    }) ?? [];

  let nearest: AttackableUnit | null = null;
  let nearestDistance = Infinity;
  let lowestHealth = Infinity;
  for (const unit of found as AttackableUnit[]) {
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
 * Directional acquisition for swipe-to-aim controls on touch devices.
 *
 * The player dragged a line: we want the target the line *points along*, not
 * merely what happens to be close to the fingertip. A line from the champion
 * out to the finger defines a ray; units inside a widening wedge around that
 * ray are candidates, and the one whose angle off the ray is smallest wins.
 *
 * "Sticky" targeting gives the previously selected target a wider angular
 * window so small thumb wobbles do not bounce the target back and forth.
 *
 * The gesture was designed for phones: you can aim a skillshot or a basic
 * attack at a champion three screens away by swiping a centimetre in
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
  const reach = Math.sqrt(dx * dx + dy * dy);
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
        PredefinedFilters.excludeStealthed,
        PredefinedFilters.visibleTo(attacker),
      ],
    }) ?? [];

  let sticky: AttackableUnit | null = null;
  let best: AttackableUnit | null = null;
  let bestAngle = Infinity;
  let bestDistance = Infinity;
  for (const unit of found as AttackableUnit[]) {
    if (unit === attacker) continue;
    const rx = unit.position.x - attacker.position.x;
    const ry = unit.position.y - attacker.position.y;
    const distance = Math.sqrt(rx * rx + ry * ry);
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
