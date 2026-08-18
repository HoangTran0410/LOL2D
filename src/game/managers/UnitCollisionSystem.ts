import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type GameObject from '@/game/gameObject/GameObject';

/**
 * Soft body separation for units.
 *
 * Bodies are circles. Two that overlap are eased apart along the line between
 * their centres, each taking half the correction — the standard approach for
 * this genre. Nothing is blocked and nothing is resolved rigidly, so a crowd
 * never deadlocks the way hard blocking does: it just spreads out over a few
 * frames.
 *
 * Three properties are worth spelling out, because losing one of them is what
 * turns separation into vibration:
 *
 * 1. Corrections are accumulated first and written once (Jacobi, not
 *    Gauss-Seidel). Resolving pairs in place would make the outcome depend on
 *    the order objects happen to sit in `ObjectManager.objects`, which changes
 *    whenever something spawns or dies.
 * 2. A body's accumulated correction is divided by the number of contacts that
 *    produced it, so a unit squeezed from six sides moves by the mean push
 *    rather than their sum. TerrainMap averages its wall overlaps the same way.
 * 3. Only part of an overlap is resolved per frame, and the result is capped.
 *    Contacts settle rather than pop.
 *
 * Pairs are found through a uniform grid rebuilt each frame over the units
 * alone. That is deliberately not the ObjectManager quadtree: that tree indexes
 * every object by its *display* box, which for an allied champion is its vision
 * radius — a 1000px square that shares a leaf with half the map. Querying it
 * once per unit would hand back long candidate lists to re-filter, and would
 * find each pair twice. The grid holds only bodies, is sized so an overlapping
 * pair always lands in adjacent cells, and walks forward neighbours only, so
 * every pair is tested exactly once.
 */

/** Fraction of an overlap taken out per frame. Under 1 so contacts ease apart. */
const SEPARATION_STIFFNESS = 0.75;
/** Overlaps under this are left alone, so resting bodies stop trading nudges. */
const OVERLAP_EPSILON = 0.5;
/** Ceiling on one frame's correction, in px. Stops a deep pile from snapping. */
const MAX_PUSH_PER_FRAME = 12;
/** Floor for the grid cell size — tiny bodies must not build a huge sparse grid. */
const MIN_CELL_SIZE = 32;
/** Below this separation two centres count as coincident. */
const COINCIDENT_DISTANCE = 1e-4;

/**
 * Cell coordinates are packed into one number. The offset keeps negatives (units
 * pushed off the map edge) positive, and the stride keeps the product exact in a
 * double.
 */
const CELL_ORIGIN = 1 << 15;
const CELL_STRIDE = 1 << 16;

/**
 * Forward neighbours only: right, down-left, down, down-right. Combined with the
 * `b > a` walk inside a cell this visits every overlapping pair exactly once.
 */
const NEIGHBOUR_KEY_OFFSETS = [CELL_STRIDE, -CELL_STRIDE + 1, 1, CELL_STRIDE + 1];

export default class UnitCollisionSystem {
  /** Runtime switch, so the same build can be measured with the pass on and off. */
  enabled = true;

  /** Bodies taking part this frame. Parallel arrays, reused between frames. */
  private units: (AttackableUnit | undefined)[] = [];
  private px: number[] = [];
  private py: number[] = [];
  private radius: number[] = [];
  private movable: boolean[] = [];
  private pushX: number[] = [];
  private pushY: number[] = [];
  private contacts: number[] = [];

  private cells = new Map<number, number[]>();
  private cellPool: number[][] = [];

  /** Bodies considered on the last resolve — read by the perf harness. */
  bodyCount = 0;

  resolve(objects: readonly GameObject[]): void {
    if (!this.enabled) {
      this.bodyCount = 0;
      return;
    }

    const count = this.collect(objects);
    this.bodyCount = count;
    if (count < 2) {
      this.clearUnits(count);
      return;
    }

    this.buildGrid(count);
    this.accumulate();
    this.apply(count);
    this.clearUnits(count);
  }

  /** Snapshot the units that take part, skipping everything that must not. */
  private collect(objects: readonly GameObject[]): number {
    let count = 0;
    for (const object of objects) {
      if (!(object instanceof AttackableUnit)) continue;
      if (!object.collidesWithUnits) continue;

      const position = object.position;
      if (!position) continue;
      const radius = object.bodyRadius;
      if (!(radius > 0)) continue;

      this.units[count] = object;
      this.px[count] = position.x;
      this.py[count] = position.y;
      this.radius[count] = radius;
      this.movable[count] = !object.isImmovable;
      this.pushX[count] = 0;
      this.pushY[count] = 0;
      this.contacts[count] = 0;
      count++;
    }
    return count;
  }

  /**
   * Cell size is twice the largest body radius on the board, so two overlapping
   * bodies are always within one cell of each other on both axes.
   */
  private buildGrid(count: number): void {
    let maxRadius = 0;
    for (let i = 0; i < count; i++) {
      if (this.radius[i] > maxRadius) maxRadius = this.radius[i];
    }
    const cellSize = Math.max(maxRadius * 2, MIN_CELL_SIZE);

    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.cellPool.push(bucket);
    }
    this.cells.clear();

    for (let i = 0; i < count; i++) {
      const cx = Math.floor(this.px[i] / cellSize);
      const cy = Math.floor(this.py[i] / cellSize);
      const key = (cx + CELL_ORIGIN) * CELL_STRIDE + (cy + CELL_ORIGIN);
      let bucket = this.cells.get(key);
      if (bucket === undefined) {
        bucket = this.cellPool.pop() ?? [];
        this.cells.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  private accumulate(): void {
    for (const [key, bucket] of this.cells) {
      const size = bucket.length;
      for (let a = 0; a < size; a++) {
        for (let b = a + 1; b < size; b++) this.testPair(bucket[a], bucket[b]);
      }

      for (let n = 0; n < NEIGHBOUR_KEY_OFFSETS.length; n++) {
        const neighbour = this.cells.get(key + NEIGHBOUR_KEY_OFFSETS[n]);
        if (neighbour === undefined) continue;
        for (let a = 0; a < size; a++) {
          for (let b = 0; b < neighbour.length; b++) this.testPair(bucket[a], neighbour[b]);
        }
      }
    }
  }

  private testPair(i: number, j: number): void {
    // two anchored bodies cannot resolve each other, so do not spend the sqrt
    if (!this.movable[i] && !this.movable[j]) return;

    const dx = this.px[j] - this.px[i];
    const dy = this.py[j] - this.py[i];
    const minDistance = this.radius[i] + this.radius[j];
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= minDistance * minDistance) return;

    const distance = Math.sqrt(distanceSq);
    const overlap = minDistance - distance;
    if (overlap <= OVERLAP_EPSILON) return;

    let nx: number;
    let ny: number;
    if (distance < COINCIDENT_DISTANCE) {
      // perfectly stacked centres have no line to part along; derive a stable
      // one from the pair itself so the same two bodies always split the same
      // way instead of shimmering on a fresh random angle every frame
      const angle = (((i * 73 + j * 149) % 360) * Math.PI) / 180;
      nx = Math.cos(angle);
      ny = Math.sin(angle);
    } else {
      nx = dx / distance;
      ny = dy / distance;
    }

    // An immovable body hands its half to the other one: a turret that got
    // shoved would either snap back to its anchor next frame (jitter) or drag
    // its collider away from its art.
    const bothMovable = this.movable[i] && this.movable[j];
    const correction = overlap * SEPARATION_STIFFNESS;
    const share = bothMovable ? 0.5 : 1;

    if (this.movable[i]) {
      this.pushX[i] -= nx * correction * share;
      this.pushY[i] -= ny * correction * share;
      this.contacts[i]++;
    }
    if (this.movable[j]) {
      this.pushX[j] += nx * correction * share;
      this.pushY[j] += ny * correction * share;
      this.contacts[j]++;
    }
  }

  private apply(count: number): void {
    for (let i = 0; i < count; i++) {
      const contacts = this.contacts[i];
      if (contacts === 0) continue;
      const unit = this.units[i];
      if (unit === undefined) continue;

      let dx = this.pushX[i] / contacts;
      let dy = this.pushY[i] / contacts;

      const lengthSq = dx * dx + dy * dy;
      if (lengthSq > MAX_PUSH_PER_FRAME * MAX_PUSH_PER_FRAME) {
        const scale = MAX_PUSH_PER_FRAME / Math.sqrt(lengthSq);
        dx *= scale;
        dy *= scale;
      }

      // `destination` is left alone on purpose: a unit shoved aside keeps
      // walking to where it was told to go.
      unit.position.x += dx;
      unit.position.y += dy;
    }
  }

  /** Drop the references so a removed unit is not held alive until next frame. */
  private clearUnits(count: number): void {
    for (let i = 0; i < count; i++) this.units[i] = undefined;
  }
}
