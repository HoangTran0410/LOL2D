import type { CastContext } from '@/game/spell/runtime/types';
import type { VfxHandle } from './SpellVfx';

type Position = Readonly<{ x: number; y: number }>;

interface CastBarUnit {
  readonly position: Position;
  readonly animatedValues: { readonly displaySize: number };
}

export function unitCastBarAnchor(unit: CastBarUnit): Position {
  return {
    x: unit.position.x,
    y: unit.position.y - unit.animatedValues.displaySize / 2,
  };
}

export default class CastBar implements VfxHandle {
  private disposed = false;

  constructor(
    readonly context: CastContext,
    private readonly getProgress: () => number,
    private readonly render: (
      context: CastContext,
      progress: number,
      anchor: Position
    ) => void = CastBar.renderDefault,
    private readonly getAnchor: () => Position = () => context.origin
  ) {}

  update(_deltaMs: number): void {}

  get complete(): boolean {
    return this.getProgress() >= 1;
  }

  draw(): void {
    if (!this.disposed) {
      this.render(this.context, Math.max(0, Math.min(1, this.getProgress())), this.getAnchor());
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private static renderDefault(_context: CastContext, progress: number, anchor: Position): void {
    const x = anchor.x - 30;
    const y = anchor.y - 45;
    push();
    noStroke();
    fill(30, 180);
    rect(x, y, 60, 6);
    fill(120, 210, 255);
    rect(x, y, 60 * progress, 6);
    pop();
  }
}
