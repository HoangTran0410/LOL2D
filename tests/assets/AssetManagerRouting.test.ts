import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AssetManager loader routing', () => {
  afterEach(() => {
    vi.doUnmock('../../src/generated/assetManifest');
    vi.resetModules();
  });

  it('routes image, JSON, and audio handles while URL handles need no loader', async () => {
    vi.resetModules();
    vi.doMock('../../src/generated/assetManifest', () => ({
      assetManifest: {
        champ_ahri: { kind: 'image', url: '/ahri.png', path: 'assets/ahri.png' },
        json_summoner_map: { kind: 'json', url: '/map.json', path: 'assets/map.json' },
        spell_flash: { kind: 'audio', url: '/flash.ogg', path: 'assets/flash.ogg' },
        cursor_normal: { kind: 'url', url: '/normal.cur', path: 'assets/normal.cur' },
      },
    }));
    const { default: AssetManager } = await import('../../src/managers/AssetManager');
    const loaders = {
      image: vi.fn(async () => ({ image: true })),
      json: vi.fn(async () => ({ json: true })),
      audio: vi.fn(async () => ({ audio: true })),
    };
    AssetManager.configureLoaders(loaders);

    await AssetManager.ensureMany([
      'champ_ahri',
      'json_summoner_map',
      'spell_flash',
      'cursor_normal',
    ]);

    expect(loaders.image).toHaveBeenCalledWith('/ahri.png');
    expect(loaders.json).toHaveBeenCalledWith('/map.json');
    expect(loaders.audio).toHaveBeenCalledWith('/flash.ogg');
    expect(AssetManager.get('cursor_normal')).toMatchObject({
      status: 'ready',
      data: '/normal.cur',
    });
    // handles are memoised, so callers can hold one and watch it flip to ready
    expect(AssetManager.get('champ_ahri')).toBe(AssetManager.get('champ_ahri'));
  });
});
