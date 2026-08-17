import type { VfxHandle } from './SpellVfx';

export interface LazyAssetHandle<TAsset> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: TAsset | null;
  url?: string;
  readonly path?: string;
}

export default class SpriteEffect<TAsset = unknown> implements VfxHandle {
  private disposed = false;
  private elapsedMs = 0;

  constructor(
    private readonly asset: LazyAssetHandle<TAsset> | undefined,
    private readonly fallback: VfxHandle,
    private readonly renderAsset: (asset: TAsset) => void = () => undefined,
    readonly durationMs = 300
  ) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('durationMs must be finite and non-negative');
    }
  }

  get complete(): boolean {
    return (
      this.disposed ||
      this.elapsedMs >= this.durationMs ||
      (this.readyAsset === undefined && this.fallback.complete === true)
    );
  }

  get effect(): VfxHandle {
    return this.readyAsset === undefined ? this.fallback : this;
  }

  update(deltaMs: number): void {
    if (this.disposed) return;
    const elapsed = Math.max(0, deltaMs);
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + elapsed);
    if (this.readyAsset === undefined) this.fallback.update(elapsed);
  }

  draw(): void {
    if (this.disposed) return;
    const asset = this.readyAsset;
    if (asset === undefined) this.fallback.draw();
    else this.renderAsset(asset);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fallback.dispose();
  }

  private get readyAsset(): TAsset | undefined {
    return this.asset?.status === 'ready' && this.asset.data !== null ? this.asset.data : undefined;
  }
}
