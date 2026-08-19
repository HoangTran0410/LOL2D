import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * `MissileSpellObject.speed`, in pixels per frame. Every distance and speed in
 * this module is per *frame*, never per second: `AttackableUnit.moveSpeed` is
 * `stats.speed.value`, which `AttackableUnit.update` adds to the position once
 * per frame, and the missile advances by its own `speed` on the same clock.
 * Converting one side to seconds and not the other is the obvious way to get a
 * lead that is 60x too long.
 */
export const DEFAULT_PROJECTILE_SPEED = 7;

/** A nudge, when the aim lands exactly on the caster. See `predictAim`. */
const DEGENERATE_NUDGE = 1;

export interface Movable {
  position: Vec2;
  destination: Vec2;
  moveSpeed: number;
}

export interface AimOptions {
  /** 0 aims at where the target is, 1 at where it will be. A difficulty knob. */
  leadFactor: number;
  aimErrorPx: number;
  projectileSpeed?: number;
  /** Usually `effectiveRange(spell.declaredRange, caster, target)`. */
  maxRange?: number;
  /** Injected so a test is deterministic; never `random()`, which is a p5 global. */
  rng?: () => number;
}

/**
 * Where the target will be one frame from now, as a displacement.
 *
 * Read off `destination` rather than a remembered previous position, because
 * `destination` is the target's *intent* after pathing: it is stable across a
 * collision push-out, a stagger, or a frame where the unit did not move at all,
 * and it needs no per-target state to compute.
 */
export function targetVelocity(target: Movable): Vec2 {
  const dx = target.destination.x - target.position.x;
  const dy = target.destination.y - target.position.y;
  const remaining = Math.hypot(dx, dy);
  // Within one step of arriving: it stops this frame, so it is not moving.
  // This is also what makes a standing target degrade to a straight aim with
  // no special case anywhere above.
  if (remaining < target.moveSpeed || remaining === 0) return { x: 0, y: 0 };
  const step = target.moveSpeed / remaining;
  return { x: dx * step, y: dy * step };
}

export function predictAim(origin: Vec2, target: Movable, options: AimOptions): Vec2 {
  const projectileSpeed = options.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED;
  const rng = options.rng ?? Math.random;

  const separation = Math.hypot(target.position.x - origin.x, target.position.y - origin.y);
  const flightFrames = projectileSpeed > 0 ? separation / projectileSpeed : 0;
  const velocity = targetVelocity(target);

  let x = target.position.x + velocity.x * flightFrames * options.leadFactor;
  let y = target.position.y + velocity.y * flightFrames * options.leadFactor;

  if (options.aimErrorPx > 0) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * options.aimErrorPx;
    x += Math.cos(angle) * radius;
    y += Math.sin(angle) * radius;
  }

  // After the error, never before: clamping first and then scattering puts the
  // aim back outside the range the spell will be checked against.
  if (options.maxRange !== undefined) {
    const dx = x - origin.x;
    const dy = y - origin.y;
    const reach = Math.hypot(dx, dy);
    if (reach > options.maxRange) {
      const scale = options.maxRange / reach;
      x = origin.x + dx * scale;
      y = origin.y + dy * scale;
    }
  }

  // `Game.facing()`'s rule, restated: a direction must never be (0,0). An aim
  // that lands exactly on the caster produces one, and every consumer then
  // multiplies it by a range and gets a dot at the caster's feet.
  if (x === origin.x && y === origin.y) return { x: x + DEGENERATE_NUDGE, y };

  return { x, y };
}
