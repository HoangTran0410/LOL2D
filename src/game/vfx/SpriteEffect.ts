import type { VfxHandle } from './SpellVfx';

export interface LazyAssetHandle<TAsset> {
  get(): TAsset | undefined;
}

export default class SpriteEffect<TAsset = unknown> implements VfxHandle {
  private disposed = false;

  constructor(
    private readonly asset: LazyAssetHandle<TAsset> | undefined,
    private readonly fallback: VfxHandle,
    private readonly renderAsset: (asset: TAsset) => void = () => undefined
  ) {}

  get effect(): VfxHandle {
    return this.asset?.get() === undefined ? this.fallback : this;
  }

  update(deltaMs: number): void {
    if (!this.disposed && this.asset?.get() === undefined) this.fallback.update(deltaMs);
  }

  draw(): void {
    if (this.disposed) return;
    const asset = this.asset?.get();
    if (asset === undefined) this.fallback.draw();
    else this.renderAsset(asset);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fallback.dispose();
  }
}
