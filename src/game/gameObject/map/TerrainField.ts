import CollideUtils from '@/utils/collide.utils';
import { Rectangle } from '@/libs/quadtree';
import type NavGrid from '@/game/nav/NavGrid';
import { wallOutlinesInArea, type TerrainHost } from './DynamicTerrain';

/**
 * The one question anything may ask about a wall: how far away is it, and which
 * way is out.
 *
 * ## Why a field and not the polygons
 *
 * `summoner_map.json` cannot express a thick wall as one shape. SAT only
 * answers for convex polygons, so every wall deeper than it is wide is authored
 * as several convex boxes butted together — 329 of them on the shipped map, for
 * far fewer actual walls.
 *
 * Each box only knows itself. Ask one which way to push a body out and it
 * answers "the shortest way out of *me*", which for a box in the middle of a
 * wall is into the box next door. `TerrainMap.pushOutOfWalls` used to ask all
 * of them and average the answers, and two opposed answers average to nothing:
 * a champion between the halves of a split slab stayed exactly where it was, in
 * solid wall, forever. Resolving them one at a time instead only turns the
 * standstill into a ping-pong — the geometry, not the arithmetic, is what has
 * no good answer.
 *
 * The measurement that settles it is on the shipped map at (6226, 4809), where
 * two of the largest wall pieces share a seam. Every convex piece there reports
 * the point as 0.12px *outside itself*. It is 78px deep in solid wall.
 *
 * A signed distance field has no such blind spot, because it never sees the
 * seam: it is baked from the union of everything that got rasterized, and an
 * internal edge is buried in the middle of the blocked region where nothing
 * queries it. How a wall was chopped up stops being something the game can
 * observe — which is the point. The map file keeps its 329 hand-drawn pieces
 * and the editor that drew them keeps working.
 *
 * ## The two halves
 *
 * Static walls come from `NavGrid.clearance`, which is the same field the
 * pathfinder plans against. That sharing is deliberate: routes used to be
 * planned against the grid and then enforced against the polygons, two
 * different answers to "where is the wall" that `NAV_MAX_ACCEPTED_OVERLAP`
 * exists to reconcile.
 *
 * Spell-made walls — an ice wall, a rock wall — cannot be in it. The field is baked
 * once at map load and those slabs appear mid-match, so they are asked
 * separately, through `wallOutlinesInArea`. Each is a single convex rectangle,
 * which is exactly the case a per-polygon test handles perfectly: one shape, no
 * seam, no disagreement to average. Callers never choose between the two —
 * every method here answers for both, and
 * `tests/game/spells/terrain-field-seam.test.ts` keeps `spells/` from reaching
 * past this file to half of it.
 */

/** Where a swept body first touches a wall, and which way that wall faces. */
export interface WallContact {
  /** The last position along the sweep that is clear — the body's resting place. */
  x: number;
  y: number;
  /** Unit vector pointing away from the wall. */
  normalX: number;
  normalY: number;
  /** How far along the sweep the contact happened, in world units. */
  travelled: number;
}

/**
 * Smallest march step, so a sweep grazing a surface still finishes. Sphere
 * tracing advances by the distance it is guaranteed to be able to cross, which
 * approaches zero as it approaches a wall; without a floor a tangent sweep
 * never terminates.
 */
const MIN_STEP = 2;

/**
 * Fraction of the reported clearance a march step actually takes.
 *
 * Sphere tracing is only conservative while the field is 1-Lipschitz — while
 * moving a pixel can change the distance by at most a pixel — and this one is
 * not, quite. The inside half is measured to the nearest cell that is not
 * `blocked`, which adds about a cell of bias to every depth, so the field falls
 * faster than 1:1 as it crosses a wall face. Stepping the full reported
 * clearance can therefore land *past* a surface, and a thin enough wall could
 * be stepped over entirely.
 *
 * `tests/game/nav/SignedField.test.ts` measures the steepest interpolated slope
 * anywhere on the shipped map and fails the build if this factor does not cover
 * it. The cost is a few extra samples per sweep, all of them array reads.
 */
export const STEP_SAFETY = 0.45;

/**
 * March steps before a sweep gives up and reports no contact.
 *
 * Only reachable by a sweep travelling parallel to a wall and within `MIN_STEP`
 * of it for its whole length — 1,024px of hugging, against a longest
 * displacement in the game well under half that. Open ground costs about five
 * steps however far it runs, because each one crosses the whole distance to the
 * nearest wall.
 */
const MAX_STEPS = 512;

/** Bisections used to place a contact on the surface once the march has crossed it. */
const REFINE_STEPS = 8;

/**
 * Directions tried when walking a body out of a wall, on top of the gradient's
 * own. 16 puts any true escape within 11.25 degrees of a candidate, which costs
 * at most a couple of percent of extra travel over the ideal line — invisible
 * against a correction that is already a teleport.
 */
const ESCAPE_DIRECTIONS = 16;

/**
 * March steps per escape direction. Each step advances by the shortfall the
 * field reports, so it converges in a handful; the cap is what stops a
 * direction that runs along a wall forever from costing anything.
 */
const ESCAPE_STEPS = 24;

/**
 * How far a body must be inside a wall before a sweep calls it blocked.
 *
 * Zero is the tempting answer and it is wrong. `resolveStatic` leaves a body at
 * rest *exactly* `radius` from the surface, so its overlap is 0 — and a shove
 * aimed straight away from that wall would be refused at travel 0 or not,
 * depending on which way the last floating-point bit fell. Every knockback next
 * to a wall would be a coin flip.
 *
 * A pixel is comfortably clear of that and comfortably under what anyone can
 * see: `tests/game/nav/SignedField.test.ts` measures the field's own worst
 * disagreement with the polygons at 1.20px, and walls are drawn with a 7px
 * stroke.
 */
const CONTACT_TOLERANCE = 1;

/**
 * How close to clear counts as clear, so a resolved body stops being resolved.
 *
 * A push lands a body where the field should read exactly `radius`, and at
 * map-scale coordinates the last few bits do not survive the arithmetic: the
 * fixed point settles a few times 1e-13 *short*, so a strict `>= radius` is
 * never satisfied and `resolveStatic` keeps returning a position forever.
 * Measured over the shipped map, 505 of 20,186 overlapping starts land there,
 * and on the last frame not one of them is still moving by as much as a
 * nanometre — they are finished, and only the comparison disagrees.
 *
 * It matters because the caller acts on the answer rather than on the movement:
 * `TerrainMap.pushOutOfWalls` fires `onCollideWall()` whenever a position comes
 * back, and `AIChampion.onCollideWall` re-rolls its destination. A bot standing
 * against a wall was reconsidering where it was going sixty times a second.
 *
 * A millionth of a pixel is a million times the noise it has to clear and a
 * million times less than anything that could be seen.
 */
const SETTLED_EPSILON = 1e-6;

type Outline = { x: number; y: number }[];

/**
 * Signed distance from a point to a convex outline: negative inside. Used only
 * for spell-made slabs, of which there are never more than a handful.
 */
const distanceToOutline = (x: number, y: number, outline: Outline): number => {
  let nearest = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const ax = outline[j].x;
    const ay = outline[j].y;
    const dx = outline[i].x - ax;
    const dy = outline[i].y - ay;
    const lengthSquared = dx * dx + dy * dy;
    let t = lengthSquared === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = x - (ax + t * dx);
    const oy = y - (ay + t * dy);
    const squared = ox * ox + oy * oy;
    if (squared < nearest) nearest = squared;
  }
  const edge = Math.sqrt(nearest);
  return CollideUtils.pointPolygon(x, y, outline) ? -edge : edge;
};

export default class TerrainField {
  private readonly host: TerrainHost;
  private readonly grid: NavGrid;

  constructor(host: TerrainHost, grid: NavGrid) {
    this.host = host;
    this.grid = grid;
  }

  /**
   * Signed distance to the nearest wall of either kind: negative inside one.
   *
   * `outlines` lets a sweep fetch the spell-made walls once and reuse them
   * across every step, rather than running a quadtree query per sample.
   */
  private distanceAt(x: number, y: number, outlines: readonly Outline[]): number {
    let nearest = this.grid.signedDistanceAt(x, y);
    // The union of two regions is the minimum of their signed distances: exact
    // for the sign either way, and exact for the magnitude *outside* the union,
    // where the nearest piece really is the nearest surface. Inside it
    // understates depth — a point buried where a spell slab overlaps a map wall
    // measures to whichever of the two it is shallower in, not to the outside of
    // both. No caller here minds. `resolveStatic` never sees the dynamic half at
    // all, and `sweep` needs the sign plus about a pixel.
    for (let i = 0; i < outlines.length; i++) {
      const other = distanceToOutline(x, y, outlines[i]);
      if (other < nearest) nearest = other;
    }
    return nearest;
  }

  /** Every spell-made wall whose outline could reach `area`. */
  private dynamicOutlines(area: Rectangle): Outline[] {
    return wallOutlinesInArea(this.host, area);
  }

  /** A box around a point, wide enough to catch a slab whose outline reaches it. */
  private static boxAround(x: number, y: number, radius: number): Rectangle {
    const reach = radius + 40;
    return new Rectangle({ x: x - reach, y: y - reach, w: reach * 2, h: reach * 2 });
  }

  // A bare `signedDistance(x, y)` and an `isInside(x, y)` lived here and had no
  // callers: `sweep` with a zero-length span already answers "is this point in a
  // wall", and every real caller wants the swept question rather than the point
  // one. Two ways to ask the same thing is what this file exists to end.

  /**
   * Unit vector pointing away from the nearest wall — the push-out direction,
   * and the outward normal of the surface a body is resting against.
   *
   * Never (0, 0): see `NavGrid.outwardAt` for how the stencil widens off the
   * field's medial axis, which is where a body buried in the middle of a thick
   * wall sits.
   */
  outwardAt(x: number, y: number): { x: number; y: number } {
    const outlines = this.dynamicOutlines(TerrainField.boxAround(x, y, 0));
    if (outlines.length === 0) return this.grid.outwardAt(x, y);

    // With a slab in reach the nearest surface may be its edge rather than the
    // baked field's, so the normal has to come from whichever one actually
    // wins. Central differences over the combined distance, for one answer that
    // stays continuous as a body crosses from one kind of wall to the other.
    const step = 8;
    const dx = this.distanceAt(x + step, y, outlines) - this.distanceAt(x - step, y, outlines);
    const dy = this.distanceAt(x, y + step, outlines) - this.distanceAt(x, y - step, outlines);
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) return { x: dx / length, y: dy / length };
    return this.grid.outwardAt(x, y);
  }

  /**
   * Resolves a body of `radius` centred at (x, y) out of any **static** wall it
   * overlaps, and reports where it ends up. Returns `null` when it was already
   * clear.
   *
   * One read and one gradient, whatever the wall is made of — against a
   * quadtree query plus an SAT test per convex piece, which is what this
   * replaced.
   *
   * Static only, deliberately: a spell-made ice wall and a spell-made rock wall each already shove
   * every unit out of their own slab every frame, and this is not the place to
   * take that over. The two would agree — both resolve to the same surface and
   * a second push finds nothing left to do — but they do not agree about *whom*
   * to push, and quietly widening that set is a different change from fixing
   * the seam.
   */
  resolveStatic(x: number, y: number, radius: number): { x: number; y: number } | null {
    const distance = this.grid.signedDistanceAt(x, y);
    if (distance >= radius - SETTLED_EPSILON) return null;

    // Outside the wall and merely touching it — the ordinary case, and the only
    // one that happens every frame. Right against a surface the field behaves
    // like the distance function it is, its gradient has unit length and points
    // at the nearest wall, and one step of `radius - distance` lands exactly on
    // the offset surface.
    if (distance >= 0) {
      const normal = this.grid.outwardAt(x, y);
      const push = radius - distance;
      return { x: x + normal.x * push, y: y + normal.y * push };
    }

    return this.escapeFrom(x, y, radius, distance);
  }

  /**
   * Walks a body that is *inside* a wall out to the nearest open ground.
   *
   * Deliberately a search rather than one step along the gradient, because deep
   * inside a wall the gradient stops meaning what the step assumes it means.
   * Halfway between two surfaces the field is flat — every direction is equally
   * uphill — and central differences there return whichever way the rounding
   * leaned. Polygon 24 of the shipped map is 282px wide at y = 3470, so a body
   * at (896, 3470) sits within 2px of its centre line: the gradient came back
   * pointing *along* the wall, the body was pushed 163px down it to another
   * centre-line point, and the next frame pushed it back. It oscillated
   * forever, 140px inside solid rock.
   *
   * So each candidate direction is *tried*: march until the field says a body
   * of this radius fits, and keep the direction that gets out soonest. The
   * gradient goes first and wins outright whenever it is trustworthy, which is
   * almost always; the ring behind it is what makes the answer exist at all
   * when it is not. `-distance` is a free head start, being the least any
   * escape can cost.
   *
   * The cost only applies to a body already inside a wall — a state nothing
   * reaches in ordinary movement, and one the old code could not get out of at
   * all.
   */
  private escapeFrom(
    x: number,
    y: number,
    radius: number,
    distance: number
  ): { x: number; y: number } {
    const seed = this.grid.outwardAt(x, y);
    let bestTravel = Infinity;
    let bestX = x;
    let bestY = y;

    for (let index = 0; index <= ESCAPE_DIRECTIONS; index++) {
      let unitX = seed.x;
      let unitY = seed.y;
      if (index > 0) {
        const angle = ((index - 1) * Math.PI * 2) / ESCAPE_DIRECTIONS;
        unitX = Math.cos(angle);
        unitY = Math.sin(angle);
      }

      let travel = -distance;
      for (let step = 0; step < ESCAPE_STEPS; step++) {
        if (travel >= bestTravel) break; // cannot beat a route already found
        const reached = this.grid.signedDistanceAt(x + unitX * travel, y + unitY * travel);
        if (reached >= radius) {
          bestTravel = travel;
          bestX = x + unitX * travel;
          bestY = y + unitY * travel;
          break;
        }
        travel += Math.max(radius - reached, MIN_STEP);
      }
    }

    // Nowhere within reach — a body inside a wall thicker than the search, which
    // this map has none of. Move it along the gradient anyway: wrong is better
    // than motionless, and the next frame gets another go from somewhere else.
    if (bestTravel === Infinity) {
      const push = radius - distance;
      return { x: x + seed.x * push, y: y + seed.y * push };
    }
    return { x: bestX, y: bestY };
  }

  /**
   * Sweeps a body of `radius` from one point toward another and reports where a
   * wall first stops it, or `null` if the whole sweep is clear.
   *
   * This is the one question every terrain-reading spell asks, however
   * differently each used to phrase it. A grapple-hook ability and an anchoring hook
   * marched their own fixed steps and took the first sample that tested inside
   * — which is up to a step *past* the surface, so a grapple-hook ability latched onto a point
   * inside the wall and then dashed to it. A shoving spell and a knockback-pin ability
   * marched at 20px and could stop that far short. A knockback ultimate intersected
   * polygon edges instead, which is exact where it applies but finds nothing at
   * all when the victim starts inside a wall, and blew them clean through it.
   *
   * Sphere tracing rather than fixed steps: each step advances by (a safe
   * fraction of) the clearance the field reports, so it cannot skip a wall
   * thinner than a stride — the shipped map has one 6px sliver — and costs a
   * handful of steps over open ground however far it runs. See `STEP_SAFETY`
   * for why the fraction is not 1. The bisection at the end puts the contact on
   * the surface rather than a step past it.
   */
  sweep(fromX: number, fromY: number, toX: number, toY: number, radius = 0): WallContact | null {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const span = Math.hypot(dx, dy);
    const outlines = this.dynamicOutlines(
      new Rectangle({
        x: Math.min(fromX, toX) - radius - 40,
        y: Math.min(fromY, toY) - radius - 40,
        w: Math.abs(dx) + (radius + 40) * 2,
        h: Math.abs(dy) + (radius + 40) * 2,
      })
    );

    const gapAt = (distance: number): number => {
      const t = span === 0 ? 0 : distance / span;
      return this.distanceAt(fromX + dx * t, fromY + dy * t, outlines) - radius;
    };

    // How embedded the body is allowed to get. For a body in the open this is
    // the plain "do not enter a wall". For one that *starts* overlapping it is
    // "do not get any worse", which is a different and necessary answer:
    // nothing pushes a `Monster` out of terrain (`TerrainMap.update` runs the
    // push-out for champions and minions only), so a wandering camp legitimately
    // sits with its body inside a wall, and a champion mid-dash is `IS_GHOSTED`
    // and skipped too. Measuring from zero instead refused every displacement on
    // such a unit — a shove pointing straight *away* from the wall included —
    // and handed the knockback-pin ability a free pin plus wall bonus at travel 0.
    const startGap = gapAt(0);
    const floor = Math.min(startGap, 0) - CONTACT_TOLERANCE;

    if (startGap < floor) {
      const normal = this.outwardAt(fromX, fromY);
      return { x: fromX, y: fromY, normalX: normal.x, normalY: normal.y, travelled: 0 };
    }
    if (span === 0) return null;

    // `reached` trails one step behind and is only written once the sample at it
    // has come back clear, which is what makes it a sound lower bound for the
    // bisection. Handing over the sample that just tested *blocked* — which the
    // first version of this did — leaves both bounds blocked, so every midpoint
    // fails, `low` never moves, and the "contact" returned is a point up to
    // MIN_STEP + CONTACT_TOLERANCE inside the wall. Measured at 2.95px worst
    // case over the shipped map: the same defect this whole file exists to fix,
    // in miniature, landing the grapple-hook ability's anchor and the knockback-pin ability's pin inside the rock.
    let reached = 0;
    let travelled = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const gap = gapAt(travelled);
      if (gap < floor) {
        return this.contactBetween(
          fromX,
          fromY,
          dx,
          dy,
          span,
          reached,
          travelled,
          outlines,
          radius,
          floor
        );
      }
      reached = travelled;
      if (travelled >= span) return null;
      travelled = Math.min(span, travelled + Math.max(gap * STEP_SAFETY, MIN_STEP));
    }

    // Budget spent with the sweep still clear: it was grazing a surface for its
    // whole length, which is not a wall stopping it.
    return null;
  }

  /** Bisects between a known-clear distance and a known-blocked one. */
  private contactBetween(
    fromX: number,
    fromY: number,
    dx: number,
    dy: number,
    span: number,
    clearAt: number,
    blockedAt: number,
    outlines: readonly Outline[],
    radius: number,
    floor: number
  ): WallContact {
    let low = clearAt;
    let high = blockedAt;
    for (let step = 0; step < REFINE_STEPS; step++) {
      const middle = (low + high) * 0.5;
      const t = middle / span;
      const gap = this.distanceAt(fromX + dx * t, fromY + dy * t, outlines) - radius;
      if (gap >= floor) low = middle;
      else high = middle;
    }

    const t = low / span;
    const x = fromX + dx * t;
    const y = fromY + dy * t;
    const normal = this.outwardAt(x, y);
    return { x, y, normalX: normal.x, normalY: normal.y, travelled: low };
  }
}

/**
 * A game with a terrain map, as much of one as this seam needs.
 *
 * `objectManager` is required and unused here on purpose: it is what the field
 * reaches for to find spell-made walls, and declaring it is also what stops
 * TypeScript treating this as a weak type and refusing every real game context
 * for having "no properties in common" with an all-optional interface.
 */
interface FieldHost {
  objectManager: unknown;
  terrainMap?: { field?: TerrainField };
}

/**
 * **The one question a spell asks about walls.**
 *
 * Sweeps a body of `radius` from one point toward another and reports where a
 * wall of either kind first stops it, or `null` if the whole line is clear.
 *
 * Five abilities used to ask this five different ways and get five different
 * answers wrong. A grapple-hook ability and an anchoring hook tested their own
 * position once a frame and took the first sample that came back inside — which
 * is up to a frame of travel *past* the surface, so a grapple-hook ability latched onto a
 * point inside the wall and then dashed to it, and every seam in that wall was
 * a place the push-out could not get her out of again. A shoving spell and
 * A knockback-pin ability marched fixed 20px steps and could stop that far short of a
 * wall, or step over one thinner than a stride. A knockback ultimate intersected
 * polygon edges instead — exact where it applies, but it finds no crossing at
 * all when the victim starts inside a wall, and blew them clean through it.
 *
 * A spell should not be able to get this wrong, so there is one way to ask.
 * `tests/game/spells/terrain-field-seam.test.ts` keeps `spells/` from reaching past
 * it to the pieces underneath.
 *
 * Answers `null` when the game has no terrain map at all, which is a test
 * fixture rather than a state the game reaches — and "no walls anywhere" is the
 * honest reading of a world without a map.
 */
export function sweepToWall(
  game: FieldHost,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius = 0
): WallContact | null {
  const field = game.terrainMap?.field;
  if (!field) return null;
  return field.sweep(fromX, fromY, toX, toY, radius);
}
