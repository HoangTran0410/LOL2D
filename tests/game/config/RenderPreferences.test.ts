import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as GameModule from '../../../src/game/Game';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('render preferences', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('defaults invalid stored values to auto quality and 60 FPS', () => {
    expect((GameModule as any).renderQualityPreference).toBeTypeOf('function');
    expect((GameModule as any).renderFpsPreference).toBeTypeOf('function');

    storage.setItem('lol2d.renderQuality', 'potato');
    storage.setItem('lol2d.renderFps', '144');

    expect((GameModule as any).renderQualityPreference()).toBe('auto');
    expect((GameModule as any).renderFpsPreference()).toBe(60);
  });

  it('persists supported quality and FPS values', () => {
    expect((GameModule as any).setRenderQualityPreference).toBeTypeOf('function');
    expect((GameModule as any).setRenderFpsPreference).toBeTypeOf('function');

    (GameModule as any).setRenderQualityPreference('low');
    (GameModule as any).setRenderFpsPreference(30);

    expect(storage.getItem('lol2d.renderQuality')).toBe('low');
    expect(storage.getItem('lol2d.renderFps')).toBe('30');
    expect((GameModule as any).renderQualityPreference()).toBe('low');
    expect((GameModule as any).renderFpsPreference()).toBe(30);
  });

  it('caps p5 rendering without changing the 60 Hz simulation rate', () => {
    const applyFrameRate = vi.fn();
    vi.stubGlobal('frameRate', applyFrameRate);
    const game = { fps: 60, renderFps: 60 };

    GameModule.default.prototype.setRenderFps.call(game as any, 30);

    expect(game.fps).toBe(60);
    expect(game.renderFps).toBe(30);
    expect(applyFrameRate).toHaveBeenCalledWith(30);
  });
});
