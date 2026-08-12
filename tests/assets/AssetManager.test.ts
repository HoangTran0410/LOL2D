import { beforeAll, describe, expect, it, vi } from 'vitest';
import AssetManager from '../../src/managers/AssetManager';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('AssetManager', () => {
  const imageLoads = new Map<string, ReturnType<typeof deferred<unknown>>>();
  const imageLoader = vi.fn((url: string) => {
    const load = deferred<unknown>();
    imageLoads.set(url, load);
    return load.promise;
  });

  beforeAll(() => {
    AssetManager.configureLoaders({
      image: imageLoader,
      json: async () => ({}),
      audio: async () => ({}),
    });
  });

  it('returns the same handle before during and after loading', async () => {
    const before = AssetManager.get('champ_ahri');
    const loading = AssetManager.ensure('champ_ahri');

    expect(AssetManager.get('champ_ahri')).toBe(before);
    expect(before.status).toBe('loading');

    const image = { width: 64 };
    imageLoads.get(before.url)?.resolve(image);
    await loading;

    expect(AssetManager.get('champ_ahri')).toBe(before);
    expect(before).toMatchObject({ status: 'ready', data: image });
  });

  it('deduplicates concurrent ensure calls', async () => {
    const first = AssetManager.ensure('champ_ashe');
    const second = AssetManager.ensure('champ_ashe');
    const handle = AssetManager.get('champ_ashe');

    expect(first).toBe(second);
    expect(imageLoader).toHaveBeenCalledTimes(1);

    imageLoads.get(handle.url)?.resolve({ width: 64 });
    await first;
  });

  it('keeps a failed handle and error without replacing its identity', async () => {
    const handle = AssetManager.get('champ_lux');
    const loading = AssetManager.ensure('champ_lux');
    const error = new Error('image failed');

    imageLoads.get(handle.url)?.reject(error);
    await expect(loading).rejects.toBe(error);

    expect(AssetManager.get('champ_lux')).toBe(handle);
    expect(handle).toMatchObject({ status: 'error', data: null, error });
  });

  it('requires an explicit placeholder label', () => {
    expect(() => AssetManager.placeholder('')).toThrow(/placeholder label/i);
    expect(AssetManager.placeholder('Missing R').key).toBeNull();
  });
});
