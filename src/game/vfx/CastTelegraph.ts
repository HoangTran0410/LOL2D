import type { CastContext } from '@/game/spell/runtime/types';
import type { VfxHandle } from './SpellVfx';

type Position = Readonly<{ x: number; y: number }>;

export default class CastTelegraph implements VfxHandle {
  private disposed = false;

  constructor(
    readonly context: CastContext,
    readonly radius: number,
    private readonly render: (
      context: CastContext,
      radius: number,
      center: Position
    ) => void = CastTelegraph.renderDefault,
    private readonly getCenter: () => Position = () => context.cursorWorld
  ) {}

  update(_deltaMs: number): void {}

  draw(): void {
    if (!this.disposed) this.render(this.context, this.radius, this.getCenter());
  }

  dispose(): void {
    this.disposed = true;
  }

  private static renderDefault(_context: CastContext, radius: number, center: Position): void {
    push();
    noFill();
    stroke(150, 210, 255, 140);
    circle(center.x, center.y, radius * 2);
    pop();
  }
}
