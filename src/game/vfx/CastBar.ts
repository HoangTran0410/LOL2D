import type { CastContext } from '../spell/runtime/types';
import type { VfxHandle } from './SpellVfx';

export default class CastBar implements VfxHandle {
  private disposed = false;

  constructor(
    readonly context: CastContext,
    private readonly getProgress: () => number,
    private readonly render: (context: CastContext, progress: number) => void = CastBar.renderDefault
  ) {}

  update(_deltaMs: number): void {}

  get complete(): boolean { return this.getProgress() >= 1; }

  draw(): void {
    if (!this.disposed) this.render(this.context, Math.max(0, Math.min(1, this.getProgress())));
  }

  dispose(): void { this.disposed = true; }

  private static renderDefault(context: CastContext, progress: number): void {
    const x = context.origin.x - 30;
    const y = context.origin.y - 45;
    push();
    noStroke();
    fill(30, 180);
    rect(x, y, 60, 6);
    fill(120, 210, 255);
    rect(x, y, 60 * progress, 6);
    pop();
  }
}
