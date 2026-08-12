import type { CastContext } from '../spell/runtime/types';
import type { VfxHandle } from './SpellVfx';

export default class CastTelegraph implements VfxHandle {
  private disposed = false;

  constructor(
    readonly context: CastContext,
    readonly radius: number,
    private readonly render: (context: CastContext, radius: number) => void = CastTelegraph.renderDefault
  ) {}

  update(_deltaMs: number): void {}

  draw(): void {
    if (!this.disposed) this.render(this.context, this.radius);
  }

  dispose(): void { this.disposed = true; }

  private static renderDefault(context: CastContext, radius: number): void {
    push();
    noFill();
    stroke(150, 210, 255, 140);
    circle(context.cursorWorld.x, context.cursorWorld.y, radius * 2);
    pop();
  }
}
