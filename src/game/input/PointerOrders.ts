import { Circle } from '@/libs/quadtree';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type Champion from '@/game/gameObject/attackableUnits/Champion';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type ObjectManager from '@/game/managers/ObjectManager';
import type { Vec2 } from '@/game/spell/runtime/types';

/** A little forgiveness around a pointer without turning nearby ground into a target. */
export const POINTER_HIT_RADIUS = 10;

/**
 * The hostile, visible body touched by `point`, or null when the pointer is on
 * ground, an ally, or something hidden from this player.
 *
 * The query keeps ObjectManager's normal collide check: its small Circle must
 * actually intersect the unit's body. `queryByDisplayBoundingBox` would instead
 * make this a centre-distance search like attack-move, which is deliberately a
 * different gesture (`A`).
 */
export function attackTargetUnderPointer(
  player: Champion,
  objectManager: Pick<ObjectManager, 'queryObjects'>,
  point: Vec2
): AttackableUnit | null {
  const found = objectManager.queryObjects({
    area: new Circle({ x: point.x, y: point.y, r: POINTER_HIT_RADIUS }),
    filters: [
      PredefinedFilters.type(AttackableUnit),
      PredefinedFilters.canTakeDamageFromTeam(player.teamId),
      PredefinedFilters.excludeStealthed,
      // Ask from this player's eyes. `visibleToPlayerTeam` is a draw flag and is
      // stale until fog has painted a frame; it is not the acquisition seam.
      PredefinedFilters.visibleTo(player),
    ],
  });

  let nearest: AttackableUnit | null = null;
  let nearestDistanceSq = Infinity;
  for (const unit of found) {
    const dx = unit.position.x - point.x;
    const dy = unit.position.y - point.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= nearestDistanceSq) continue;
    nearest = unit;
    nearestDistanceSq = distanceSq;
  }
  return nearest;
}

/**
 * League-style right click: attack the hostile body under the pointer, otherwise
 * move to the ground point. Returns the selected target for input feedback and
 * tests; null means a move order was issued.
 */
export function issuePointerOrder(
  player: Champion,
  objectManager: Pick<ObjectManager, 'queryObjects'>,
  point: Vec2
): AttackableUnit | null {
  const target = attackTargetUnderPointer(player, objectManager, point);
  if (target) player.orderAttack(target);
  else player.orderMove(point.x, point.y, true);
  return target;
}
