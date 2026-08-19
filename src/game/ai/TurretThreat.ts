import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * The one description of "a turret can shoot me here", as pure geometry.
 *
 * `BotBrain` knew nothing about enemy buildings, and every consequence of that
 * was the same bug: a bot walked into the guns and stayed there. `pushTarget`
 * hands back the enemy turret's own coordinates when its lane holds no friendly
 * wave, `drive` walked to them, and `findObjectiveTarget` — which *does* have an
 * escort rule — then refused to give the bot anything to shoot. So it stood
 * under the turret, attacking nothing, until it died.
 *
 * Pure and structural, in the shape `LaneObjectives.ts` already established:
 * `TeamBlackboard` gathers the buildings inside the one pass it already makes,
 * this module turns them into numbers, and `BotBrain` reads the answer. Nothing
 * here imports `Turret`, so the whole thing is testable without a match.
 */

/** What this module needs from a turret. `Turret` satisfies it structurally. */
export interface TurretThreatSource {
  position: Vec2;
  /** The building's own reach, from its preset — 430 by default. */
  attackRange: number;
  isDead?: boolean;
  toRemove?: boolean;
}

/** A turret that is rubble or on its way out of the match threatens nobody. */
const live = (turret: TurretThreatSource): boolean => !turret.isDead && !turret.toRemove;

/**
 * How far from the turret's centre a body of `bodyRadius` starts being hit.
 *
 * Surface to surface, the same correction `BasicAttackController.reachTo` makes:
 * `Turret.stillValidTarget` measures centre to centre against `attackRange`, so
 * strictly the body radius is not part of *its* test — it is part of ours,
 * because a bot standing exactly on the line is one step of separation away
 * from being inside it.
 */
export const turretReach = (turret: TurretThreatSource, bodyRadius: number): number =>
  turret.attackRange + bodyRadius;

/** Whether a body standing at `at` is inside this turret's guns. */
export function insideThreat(
  turret: TurretThreatSource,
  at: Vec2,
  bodyRadius: number,
  clearance = 0
): boolean {
  if (!live(turret)) return false;
  const reach = turretReach(turret, bodyRadius) + clearance;
  const dx = at.x - turret.position.x;
  const dy = at.y - turret.position.y;
  return dx * dx + dy * dy < reach * reach;
}

/**
 * The nearest point outside `turret`'s reach, on the ray from the turret through
 * the body — the shortest way out, which is straight back the way it came.
 *
 * `clearance` is the margin past the guns, so a bot that has just walked out is
 * not one step of body separation from walking back in.
 */
export function escapePoint(
  turret: TurretThreatSource,
  from: Vec2,
  bodyRadius: number,
  clearance: number
): Vec2 {
  const ring = turretReach(turret, bodyRadius) + clearance;
  let dx = from.x - turret.position.x;
  let dy = from.y - turret.position.y;
  const away = Math.hypot(dx, dy);
  if (away < 0.01) {
    // A direction must never be (0,0) — `Game.facing()`'s convention. A body
    // standing exactly on the turret has no "back the way it came", so any
    // fixed vector will do and a constant one keeps the answer testable.
    dx = 1;
    dy = 0;
  } else {
    dx /= away;
    dy /= away;
  }
  return { x: turret.position.x + dx * ring, y: turret.position.y + dy * ring };
}

/**
 * `to`, pulled back to the first turret ring the walk would cross.
 *
 * A bot ordered somewhere across an enemy turret's reach stops at the edge
 * instead of walking through it. Deliberately *not* a route around the ring:
 * routing is `NavigationSystem`'s job and it rasterizes the static map once at
 * match start, so a building's threat — which comes and goes with the building
 * — cannot live there. Stopping short is the honest, conservative answer to
 * "do not walk into the guns", and the posture layer decides what to do next.
 *
 * A turret whose **guns the body is already in** is skipped. Otherwise the clamp
 * lands on the body's own position and a bot that got dragged under a turret is
 * pinned there by the very rule meant to keep it out; walking back out is
 * DISENGAGE's job, through `escapePoint`.
 *
 * The guns, and not the keep-out ring — the distinction is the whole of a
 * shipped bug. `clearance` puts a band between the two, and skipping on the
 * outer radius handed that band to no rule at all: from inside a ring the entry
 * root is negative, every turret is discarded, and the clamp goes quiet exactly
 * where its own answer had just parked the body. A bot walked to the line, was
 * let through on the next tick, crossed into the guns, was pushed back to the
 * line by DISENGAGE, and did it again four times a second — reported from a
 * real match as a bot pacing in and out of turret range. Inside the band the
 * ring becomes the body's own distance instead, which refuses a step inward and
 * leaves stepping out or sideways alone.
 */
export function clampToSafeApproach(
  from: Vec2,
  to: Vec2,
  turrets: readonly TurretThreatSource[],
  bodyRadius: number,
  clearance: number
): Vec2 {
  const spanX = to.x - from.x;
  const spanY = to.y - from.y;
  const spanSq = spanX * spanX + spanY * spanY;
  if (spanSq <= 0) return { x: to.x, y: to.y };

  let earliest = 1;
  for (const turret of turrets) {
    if (!live(turret)) continue;
    const guns = turretReach(turret, bodyRadius);
    const offsetX = from.x - turret.position.x;
    const offsetY = from.y - turret.position.y;
    const startSq = offsetX * offsetX + offsetY * offsetY;
    if (startSq <= guns * guns) continue; // being shot at already: DISENGAGE's problem

    // The ring this walk may not cross. Normally the keep-out line; for a body
    // already inside it, its own distance, so the band between the two is a
    // floor rather than a hole. See the note above.
    const ring = Math.min(guns + clearance, Math.sqrt(startSq));

    // Where the segment first reaches the ring: the smaller root of
    // |from + t*span - centre|^2 = ring^2, which is a plain quadratic in t.
    const b = offsetX * spanX + offsetY * spanY;
    const c = startSq - ring * ring;
    const discriminant = b * b - spanSq * c;
    if (discriminant <= 0) continue; // the walk misses the ring entirely

    const entry = (-b - Math.sqrt(discriminant)) / spanSq;
    // `< 0`, not `<= 0`. A body standing exactly on the ring and ordered inward
    // has an entry root of exactly 0, and discarding that as "no crossing" is
    // the other half of the same hole: 0 is a real answer, and it means the
    // body may not take the step at all. A body ordered *outward* from the ring
    // roots at a negative t and is left alone, which is what lets it leave.
    if (entry < 0 || entry >= earliest) continue;
    earliest = entry;
  }

  if (earliest >= 1) return { x: to.x, y: to.y };
  return { x: from.x + spanX * earliest, y: from.y + spanY * earliest };
}
