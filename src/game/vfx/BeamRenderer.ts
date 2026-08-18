import type { BeamGeometry } from '@/game/gameObject/spellObjects/BeamSpellObject';
import type { VfxHandle } from './SpellVfx';

export default class BeamRenderer implements VfxHandle {
  private disposed = false;

  constructor(
    readonly geometry: BeamGeometry,
    private readonly render: (geometry: BeamGeometry) => void = BeamRenderer.renderDefault
  ) {}

  update(_deltaMs: number): void {}

  draw(): void {
    if (!this.disposed) this.render(this.geometry);
  }

  dispose(): void {
    this.disposed = true;
  }

  private static renderDefault(geometry: BeamGeometry): void {
    push();
    stroke(180, 220, 255, 180);
    strokeWeight(geometry.width);
    line(geometry.start.x, geometry.start.y, geometry.end.x, geometry.end.y);
    pop();
  }
}
