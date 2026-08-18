/**
 * Turning a thumb drag into the world point a spell is cast at.
 *
 * Pure — it takes a drag in screen pixels and hands back a world position, so
 * every rule below is testable without a canvas, a camera or a game.
 *
 * The whole file exists because a drag and a cast context want different
 * things. `CastContext` is built by TargetResolver out of a *cursor world
 * point*: DIRECTION derives its unit vector from it, POINT is measured against
 * range from it, UNIT requires it to land inside a body's selection radius.
 * A thumb, meanwhile, produces 60 pixels of travel from a button in the corner.
 * This maps one onto the other, per targeting mode, and nothing downstream has
 * to learn that a touch happened.
 */
import type { TargetingMode, Vec2 } from '@/game/spell/runtime/types';

export interface AimCandidate {
  readonly position: Vec2;
}

export interface SpellAimInput {
  readonly mode: TargetingMode;
  /** The champion. Every aim is measured from here, never from the camera. */
  readonly origin: Vec2;
  /** How far this spell reaches, in world units. */
  readonly range: number;
  /**
   * Drag in *screen* pixels from the button the thumb is on, or null for a tap
   * that never moved.
   */
  readonly drag: Vec2 | null;
  /** Screen pixels of drag that map to the full range. */
  readonly dragToRange: number;
  /** Where the champion is pointed, used when a tap has nothing to aim at. */
  readonly facing: Vec2;
  /** The tap's auto-picked victim, or null when nothing is in reach. */
  readonly autoTarget: AimCandidate | null;
  /** UNIT mode only: the previous frame's lock, retained with hysteresis. */
  readonly lockedTarget?: AimCandidate | null;
  /** UNIT mode only: the body nearest a world point, within a world radius. */
  readonly pickUnitNear?: (
    point: Vec2,
    radius: number,
    preferred: AimCandidate | null
  ) => AimCandidate | null;
}

export interface SpellAimResult {
  /** What goes into CastContext.cursorWorld. */
  readonly cursorWorld: Vec2;
  /** Unit vector from origin to cursorWorld, for drawing the telegraph. */
  readonly direction: Vec2;
  /** Distance from origin to cursorWorld, for drawing the telegraph. */
  readonly distance: number;
  /** UNIT mode: the body this gesture has locked, so the HUD can ring it. */
  readonly target: AimCandidate | null;
  /** True when the aim came from a drag rather than the auto-target. */
  readonly manual: boolean;
}

/**
 * How wide a net UNIT mode casts around the projected aim point.
 *
 * Generous on purpose: a thumb picks a direction, not a pixel, and the resolver
 * downstream still has to agree the body is targetable and in range. 220 world
 * units is roughly three champion bodies.
 */
export const UNIT_SNAP_RADIUS = 220;

/** Where a tap places a POINT spell when there is nobody to place it on. */
export const BLIND_POINT_FRACTION = 0.6;

const normalise = (x: number, y: number): Vec2 => {
  const length = Math.sqrt(x * x + y * y);
  return length === 0 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
};

const project = (origin: Vec2, direction: Vec2, distance: number): Vec2 => ({
  x: origin.x + direction.x * distance,
  y: origin.y + direction.y * distance,
});

const finish = (
  origin: Vec2,
  cursorWorld: Vec2,
  target: AimCandidate | null,
  manual: boolean
): SpellAimResult => {
  const dx = cursorWorld.x - origin.x;
  const dy = cursorWorld.y - origin.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  return {
    cursorWorld,
    direction: length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length },
    distance: length,
    target,
    manual,
  };
};

/**
 * The aim a gesture currently means.
 *
 * Per mode, and each choice is about what a thumb can actually express:
 *
 * - **DIRECTION** — direction only. A skillshot fires its own length; the drag
 *   picks where it points and nothing else. Trying to encode range in the drag
 *   too would put a 900-unit spell inside 60 pixels of glass.
 * - **POINT** — direction *and* distance. A placed circle has somewhere to go
 *   within its range, so the drag's length maps onto it, clamped at the edge.
 * - **UNIT** — the drag picks a body. The cursor is snapped onto that body's
 *   centre, because TargetResolver's UNIT branch only accepts a cursor inside a
 *   candidate's selection radius; aiming "near" a champion would otherwise
 *   resolve to nothing.
 * - **SELF** — there is nothing to aim. The cursor is the champion.
 *
 * A tap (`drag === null`) takes the auto-target in every mode. With nothing to
 * auto-target, DIRECTION and POINT fall back to the champion's facing — that is
 * what a Wild Rift tap into empty space does — and UNIT returns the origin,
 * which TargetResolver then refuses outright rather than burning the cooldown.
 */
export function resolveSpellAim(input: SpellAimInput): SpellAimResult {
  const { mode, origin, range, drag } = input;

  if (mode === 'SELF') return finish(origin, { x: origin.x, y: origin.y }, null, drag !== null);

  const dragLength = drag ? Math.sqrt(drag.x * drag.x + drag.y * drag.y) : 0;
  const manual = drag !== null && dragLength > 0;
  const direction = manual
    ? normalise(drag!.x, drag!.y)
    : normalise(input.facing.x, input.facing.y);

  if (mode === 'UNIT') {
    if (!manual) {
      const auto = input.autoTarget;
      return auto
        ? finish(origin, { x: auto.position.x, y: auto.position.y }, auto, false)
        : finish(origin, { x: origin.x, y: origin.y }, null, false);
    }
    const probe = project(origin, direction, range);
    const picked =
      input.pickUnitNear?.(probe, UNIT_SNAP_RADIUS, input.lockedTarget ?? null) ?? null;
    return picked
      ? finish(origin, { x: picked.position.x, y: picked.position.y }, picked, true)
      : finish(origin, probe, null, true);
  }

  if (mode === 'POINT') {
    if (!manual) {
      const auto = input.autoTarget;
      if (auto) {
        const dx = auto.position.x - origin.x;
        const dy = auto.position.y - origin.y;
        const length = Math.hypot(dx, dy);
        // Clamped rather than refused: a tap aimed just past the edge of the
        // range should land at the edge, not fail silently.
        const clamped = length <= range ? length : range;
        return finish(origin, project(origin, normalise(dx, dy), clamped), auto, false);
      }
      return finish(origin, project(origin, direction, range * BLIND_POINT_FRACTION), null, false);
    }
    const reach = Math.min(1, dragLength / Math.max(1, input.dragToRange)) * range;
    return finish(origin, project(origin, direction, reach), null, true);
  }

  // DIRECTION
  if (!manual) {
    const auto = input.autoTarget;
    const aimDirection = auto
      ? normalise(auto.position.x - origin.x, auto.position.y - origin.y)
      : direction;
    return finish(origin, project(origin, aimDirection, range), auto, false);
  }
  return finish(origin, project(origin, direction, range), null, true);
}

/**
 * Fallback reach for a spell that never says how far it goes.
 *
 * Only six spells declare a `targetingRequest.range`, and most of the rest keep
 * their reach in a `range` field the base class knows nothing about. 600 world
 * units is a little over the 550 the mid-range abilities use, so the telegraph
 * of an undeclared spell overstates its reach slightly rather than understating
 * it — a skillshot that lands short of the line reads as a miss you made, one
 * that flies past it reads as the game lying.
 */
export const DEFAULT_TOUCH_AIM_RANGE = 600;

/** Everything the aim layer needs of a spell to know how far it reaches. */
export interface AimRangeSource {
  readonly targetingRequest?: { readonly range?: number };
  readonly range?: number;
  readonly castRange?: number;
}

export function touchAimRange(spell: AimRangeSource | null | undefined): number {
  const declared = spell?.targetingRequest?.range ?? spell?.range ?? spell?.castRange;
  return typeof declared === 'number' && declared > 0 ? declared : DEFAULT_TOUCH_AIM_RANGE;
}

export default resolveSpellAim;
