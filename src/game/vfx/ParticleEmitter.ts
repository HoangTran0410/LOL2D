import type { Vec2 } from '@/game/spell/runtime/types';
import type { VfxHandle } from './SpellVfx';

export default class ParticleEmitter implements VfxHandle {
  protected elapsedMs = 0;
  protected disposed = false;

  constructor(
    readonly position: Vec2,
    readonly durationMs = 300
  ) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('durationMs must be finite and non-negative');
    }
  }

  get complete(): boolean {
    return this.disposed || this.elapsedMs >= this.durationMs;
  }

  update(deltaMs: number): void {
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + Math.max(0, deltaMs));
  }

  draw(): void {
    if (this.disposed) return;
    const ratio = this.durationMs === 0 ? 1 : this.elapsedMs / this.durationMs;
    push();
    noFill();
    stroke(180, 220, 255, 180 * (1 - ratio));
    circle(this.position.x, this.position.y, 8 + ratio * 32);
    pop();
  }

  dispose(): void {
    this.disposed = true;
  }
}
