import type { Vec2 } from '@moba2d/core/content/types';

/**
 * Lux R's beam, moved out of `src/game/vfx/` (Task 2 of the content-pack
 * extraction).
 *
 * Two things changed to cross the pack boundary, neither a behaviour change:
 *
 * - **`BeamGeometry` is redeclared here instead of imported from
 *   `@/game/gameObject/spellObjects/BeamSpellObject`.** The `pack-core-boundary` seam
 *   only allows a pack file to reach core through `@moba2d/core/content/ContentApi`,
 *   `@moba2d/core/content/ContentPack` and `@moba2d/core/content/types`, type-only — `BeamSpellObject`
 *   is none of those. The shape is trivial (`{ start, end, width }` over the
 *   same `Vec2` this file already gets from `@moba2d/core/content/types`), so redeclaring
 *   it costs nothing: TypeScript's structural typing makes this interface and
 *   core's `BeamGeometry` freely assignable to each other, so `Lux_R.ts`
 *   (still core, still importing the original `BeamGeometry`) can keep
 *   constructing this class with no cast on either side.
 * - **The `VfxHandle` implements clause is dropped**, for the same boundary
 *   reason — `./SpellVfx` is a core module, not one of the three allowed
 *   specifiers. `implements` is a compile-time self-check only; this class
 *   still has the exact `update`/`draw`/`dispose`/`complete` shape `VfxHandle`
 *   describes; nothing that consumes it needs the label. `Lux_R.ts` holds its
 *   instance typed as `LuxBeamEffect` directly and never as `VfxHandle`.
 */

type Phase = 'prepare' | 'release';

const RELEASE_MS = 450;

export interface BeamGeometry {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly width: number;
}

export default class LuxBeamEffect {
  private elapsedMs = 0;
  private disposed = false;
  private started = false;

  constructor(
    readonly geometry: BeamGeometry,
    readonly phase: Phase,
    private readonly getProgress: () => number = () => 1
  ) {}

  get complete(): boolean {
    return this.phase === 'release' && this.elapsedMs >= RELEASE_MS;
  }

  update(deltaMs: number): void {
    if (this.disposed || this.phase !== 'release') return;
    if (!this.started) {
      this.started = true;
      return;
    }
    this.elapsedMs = Math.min(RELEASE_MS, this.elapsedMs + Math.max(0, deltaMs));
  }

  draw(): void {
    if (this.disposed) return;
    if (this.phase === 'prepare') this.drawPrepare();
    else this.drawRelease();
  }

  dispose(): void {
    this.disposed = true;
  }

  private drawPrepare(): void {
    const progress = Math.max(0, Math.min(1, this.getProgress()));
    const width = this.geometry.width * (0.15 + progress * 0.85);
    push();
    noFill();
    stroke(120, 180, 255, 45 + progress * 80);
    strokeWeight(width);
    this.drawCenterLine();
    stroke(245, 250, 255, 150 + progress * 80);
    strokeWeight(2 + progress * 3);
    this.drawCenterLine();
    pop();
  }

  private drawRelease(): void {
    const progress = this.elapsedMs / RELEASE_MS;
    const alpha = 255 * (1 - progress);
    const width = this.geometry.width * (1 - progress * 0.55);
    const dx = this.geometry.end.x - this.geometry.start.x;
    const dy = this.geometry.end.y - this.geometry.start.y;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;

    push();
    noFill();
    stroke(120, 110, 255, alpha * 0.22);
    strokeWeight(width * 1.35);
    this.drawCenterLine();
    stroke(120, 225, 255, alpha * 0.5);
    strokeWeight(width * 0.72);
    this.drawCenterLine();
    stroke(255, 255, 255, alpha);
    strokeWeight(Math.max(6, width * 0.2));
    this.drawCenterLine();

    for (let index = -2; index <= 2; index++) {
      const offset = normalX * index * width * 0.14 * (1 - progress);
      const offsetY = normalY * index * width * 0.14 * (1 - progress);
      stroke(205 + index * 6, 245, 255, alpha * 0.8);
      strokeWeight(Math.max(2, width * 0.035));
      line(
        this.geometry.start.x + offset,
        this.geometry.start.y + offsetY,
        this.geometry.end.x - offset,
        this.geometry.end.y - offsetY
      );
    }
    pop();
  }

  private drawCenterLine(): void {
    line(this.geometry.start.x, this.geometry.start.y, this.geometry.end.x, this.geometry.end.y);
  }
}
