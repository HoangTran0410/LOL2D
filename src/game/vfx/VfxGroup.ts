import type { VfxHandle } from './SpellVfx';

export default class VfxGroup implements VfxHandle {
  private disposed = false;

  constructor(private readonly effects: VfxHandle[]) {}

  get complete(): boolean {
    return this.effects.every(effect => effect.complete === true);
  }

  update(deltaMs: number): void {
    if (!this.disposed) this.effects.forEach(effect => effect.update(deltaMs));
  }

  draw(): void {
    if (!this.disposed) this.effects.forEach(effect => effect.draw());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.effects.forEach(effect => effect.dispose());
  }
}
