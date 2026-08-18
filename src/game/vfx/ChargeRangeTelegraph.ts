import type { Vec2 } from '@/game/spell/runtime/types';
import type { VfxHandle } from './SpellVfx';

type Renderer = (origin: Vec2, direction: Vec2, range: number, progress: number) => void;

export default class ChargeRangeTelegraph implements VfxHandle {
  private disposed = false;

  constructor(
    private readonly getOrigin: () => Vec2,
    private readonly getDirection: () => Vec2,
    private readonly getRange: () => number,
    private readonly getProgress: () => number,
    private readonly render: Renderer = ChargeRangeTelegraph.renderDefault
  ) {}

  update(_deltaMs: number): void {}

  draw(): void {
    if (this.disposed) return;
    this.render(
      this.getOrigin(),
      this.getDirection(),
      this.getRange(),
      Math.max(0, Math.min(1, this.getProgress()))
    );
  }

  dispose(): void {
    this.disposed = true;
  }

  private static renderDefault(
    origin: Vec2,
    direction: Vec2,
    range: number,
    progress: number
  ): void {
    const endX = origin.x + direction.x * range;
    const endY = origin.y + direction.y * range;
    push();
    noFill();
    stroke(120, 210, 255, 90 + progress * 100);
    strokeWeight(8 + progress * 4);
    line(origin.x, origin.y, endX, endY);
    stroke(235, 250, 255, 220);
    strokeWeight(2);
    line(origin.x, origin.y, endX, endY);
    circle(endX, endY, 10 + progress * 6);
    pop();
  }
}
