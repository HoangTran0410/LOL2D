import { DEFAULT_UNIT_SIZE } from '@/game/gameObject/Stats';
import { withinRadius } from '@/utils/math.utils';

/**
 * Size-aware reach for caster-centred ranges.
 *
 * Ability ranges are measured from the caster's centre, but bodies take up
 * space and push each other apart: `UnitCollisionSystem` holds two units at
 * least `bodyRadius(a) + bodyRadius(b)` apart. Grow a champion — a stacking
 * self-buff can reach MAX_UNIT_SIZE — and the nearest an enemy's centre can
 * ever get grows with it, while the range stayed where it was written. Ranges
 * shorter than that separation stop working entirely rather than partially: a
 * melee-range ultimate looks for enemies inside 80 units and, at full size,
 * cannot be satisfied by a body that is physically forbidden from coming
 * closer than 110.
 *
 * The rule is to give back only what a grown body took away:
 *
 *     effectiveRange = authoredRange
 *                    + max(0, casterBodyRadius - DEFAULT_BODY_RADIUS)
 *                    + max(0, targetBodyRadius - DEFAULT_BODY_RADIUS)
 *
 * The excess, not the whole radius. Every range in this repository was authored
 * with default-sized bodies on the board, so the excess is a no-op at default
 * size — the same casts land at the same distances they always did — whereas
 * adding the full radius would silently lengthen some eighty abilities by 55
 * units each and rebalance the whole game.
 *
 * The `max(0, ...)` matters at the small end too. A minion is 34 across, well
 * under a champion, and a spell must not reach less far because it is aimed at
 * something small.
 *
 * Body size is read from `stats.size`, the same circle separation itself uses,
 * rather than the lerped `animatedValues.size`. A reach derived from the lerp
 * would trail the separation it has to clear for the second or so a growing
 * body takes to catch up, which is exactly the window in which the spell would
 * look broken again.
 *
 * ## Which term a call site needs
 *
 * `ObjectManager.queryObjects` adds a surface test of its own: unless a query
 * asks for `queryByDisplayBoundingBox`, every candidate must also pass
 * `collideWith(area)`, which intersects the query circle with the candidate's
 * *body* circle. Such a query is therefore already target-size-aware — its
 * reach grows one for one with the target — and needs only the caster term:
 *
 *     r: effectiveRange(this.range, this.owner)
 *
 * A site that measures centre to centre itself — an explicit `dist()` against a
 * range, or a query that opted out of the surface test — has no target term at
 * all and must ask for both:
 *
 *     withinRange(this.range, this.owner, target)
 *
 * Handing both ends to a query that already has a surface test would count the
 * target twice, so the distinction is load-bearing rather than stylistic.
 *
 * ## What this is not for
 *
 * Only "can the caster reach that unit" questions — the checks that pick a
 * victim or validate a target. How far a missile flies, how far away a point
 * may be nominated on the ground, how big a blast is where it lands, how far a
 * dash carries: none of those are reach, and a fat archer does not shoot
 * further. Basic attacks are outside this module too. `attackRange` is already
 * authored surface to surface, so `BasicAttackController.reachTo` adds whole
 * radii on purpose and must keep doing so.
 */

/** Half of the body every range in the game was written against. */
export const DEFAULT_BODY_RADIUS = DEFAULT_UNIT_SIZE / 2;

/**
 * The parts of a unit this module reads. Structural on purpose: spell tests
 * hand in plain stubs, and a stub carrying a size is a perfectly good body.
 */
export interface ReachBody {
  readonly bodyRadius?: number;
  readonly collisionRadius?: number;
  readonly stats?: { readonly size?: { readonly value: number } };
  readonly position?: { readonly x: number; readonly y: number };
}

const asBody = (value: unknown): ReachBody | null =>
  typeof value === 'object' && value !== null ? (value as ReachBody) : null;

/**
 * Body radius of a unit. Accepts a unit, a radius already in hand, or nothing
 * at all — TargetResolver holds its caster and candidates as `unknown`, and a
 * helper that forces a cast on every call site would just move the risk.
 *
 * An unrecognised value is treated as a default body, so it contributes zero.
 */
export function bodyRadiusOf(source?: unknown): number {
  if (typeof source === 'number') return source;
  const body = asBody(source);
  if (!body) return DEFAULT_BODY_RADIUS;
  const size = body.stats?.size?.value;
  if (typeof size === 'number') return size / 2;
  if (typeof body.bodyRadius === 'number') return body.bodyRadius;
  if (typeof body.collisionRadius === 'number') return body.collisionRadius;
  return DEFAULT_BODY_RADIUS;
}

/** Reach a body gives back by being larger than default. Never negative. */
export function bodyReachBonus(source?: unknown): number {
  return Math.max(0, bodyRadiusOf(source) - DEFAULT_BODY_RADIUS);
}

/**
 * An authored range corrected for the bodies at each end of it.
 *
 * Pass the target only when the call site measures centre to centre itself;
 * see the note on query sites above.
 */
export function effectiveRange(authoredRange: number, caster?: unknown, target?: unknown): number {
  return authoredRange + bodyReachBonus(caster) + bodyReachBonus(target);
}

const positionOf = (source: unknown): { x: number; y: number } | null => {
  const position = asBody(source)?.position;
  return position && typeof position.x === 'number' && typeof position.y === 'number'
    ? { x: position.x, y: position.y }
    : null;
};

/**
 * Whether `target` is inside `authoredRange` of `caster`, measuring centre to
 * centre and correcting both bodies. For sites that own their own distance
 * test; a query that keeps `collideWith` should widen its radius instead.
 *
 * A unit with no position is out of range rather than at the origin.
 */
export function withinRange(authoredRange: number, caster: unknown, target: unknown): boolean {
  const from = positionOf(caster);
  const to = positionOf(target);
  if (!from || !to) return false;
  const reach = effectiveRange(authoredRange, caster, target);
  return withinRadius(from, to, reach);
}
