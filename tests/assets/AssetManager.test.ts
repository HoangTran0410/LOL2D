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

function stubPlaceholderGraphics(marker: object) {
  const graphics = {
    colorMode: vi.fn(),
    noStroke: vi.fn(),
    fill: vi.fn(),
    rect: vi.fn(),
    noFill: vi.fn(),
    stroke: vi.fn(),
    strokeWeight: vi.fn(),
    textAlign: vi.fn(),
    textSize: vi.fn(),
    textStyle: vi.fn(),
    text: vi.fn(),
    ...marker,
  };
  vi.stubGlobal('HSL', 'hsl');
  vi.stubGlobal('CENTER', 'center');
  vi.stubGlobal('BOLD', 'bold');
  vi.stubGlobal(
    'createGraphics',
    vi.fn(() => graphics)
  );
  return graphics;
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
    const before = AssetManager.get('buff_airborne');
    const loading = AssetManager.ensure('buff_airborne');

    expect(AssetManager.get('buff_airborne')).toBe(before);
    expect(before.status).toBe('loading');

    const image = { width: 64 };
    imageLoads.get(before.url)?.resolve(image);
    await loading;

    expect(AssetManager.get('buff_airborne')).toBe(before);
    expect(before).toMatchObject({ status: 'ready', data: image });
  });

  it('deduplicates concurrent ensure calls', async () => {
    const first = AssetManager.ensure('buff_charm');
    const second = AssetManager.ensure('buff_charm');
    const handle = AssetManager.get('buff_charm');

    expect(first).toBe(second);
    expect(imageLoader).toHaveBeenCalledTimes(1);

    imageLoads.get(handle.url)?.resolve({ width: 64 });
    await first;
  });

  it('keeps the handle identity and retries a transient failed load', async () => {
    const handle = AssetManager.get('buff_stun');
    const loading = AssetManager.ensure('buff_stun');
    const error = new Error('image failed');

    imageLoads.get(handle.url)?.reject(error);
    await expect(loading).rejects.toBe(error);

    expect(AssetManager.get('buff_stun')).toBe(handle);
    expect(handle).toMatchObject({ status: 'error', data: null, error });

    const callsBeforeRetry = imageLoader.mock.calls.length;
    const retry = AssetManager.ensure('buff_stun');
    expect(retry).not.toBe(loading);
    expect(imageLoader).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    expect(handle.status).toBe('loading');

    const image = { width: 64, retried: true };
    imageLoads.get(handle.url)?.resolve(image);
    await retry;

    expect(AssetManager.get('buff_stun')).toBe(handle);
    expect(handle).toMatchObject({ status: 'ready', data: image, error: undefined });
  });

  it('requires an explicit placeholder label', () => {
    expect(() => AssetManager.placeholder('')).toThrow(/placeholder label/i);
    expect(AssetManager.placeholder('Missing R').key).toBeNull();
  });

  it('renders a placeholder on first canvas use and loaded data through the same handle', async () => {
    const placeholder = stubPlaceholderGraphics({ placeholder: true });
    const handle = AssetManager.get('buff_slow');

    expect(AssetManager.renderable(handle)).toBe(placeholder);
    expect(AssetManager.renderable(handle)).toBe(placeholder);
    expect(imageLoader).toHaveBeenCalledTimes(1);

    const image = { width: 64 };
    imageLoads.get(handle.url)?.resolve(image);
    await AssetManager.ensure('buff_slow');

    expect(AssetManager.renderable(handle)).toBe(image);
    expect(AssetManager.get('buff_slow')).toBe(handle);
  });

  it('auto-retries one failed on-use load without request-storming, while explicit retry remains available', async () => {
    const placeholder = stubPlaceholderGraphics({ placeholder: true });
    const handle = AssetManager.get('buff_root');

    expect(AssetManager.renderable(handle, 'Blitzcrank')).toBe(placeholder);
    imageLoads.get(handle.url)?.reject(new Error('draw load failed'));
    await vi.waitFor(() => expect(handle.status).toBe('error'));

    // The next rendered frame gives one transient failure a second chance.
    expect(AssetManager.renderable(handle, 'Blitzcrank')).toBe(placeholder);
    expect(imageLoader).toHaveBeenCalledTimes(2);
    expect(handle.status).toBe('loading');

    // While that retry is in flight, rendering is read-only no matter how many
    // frames arrive.
    for (let frame = 0; frame < 10; frame++) {
      expect(AssetManager.renderable(handle, 'Blitzcrank')).toBe(placeholder);
    }
    expect(imageLoader).toHaveBeenCalledTimes(2);

    imageLoads.get(handle.url)?.reject(new Error('draw retry failed'));
    await vi.waitFor(() => expect(handle.status).toBe('error'));

    // A persistent failure stays a placeholder rather than opening one request
    // on every draw frame.
    for (let frame = 0; frame < 10; frame++) {
      expect(AssetManager.renderable(handle, 'Blitzcrank')).toBe(placeholder);
    }
    expect(imageLoader).toHaveBeenCalledTimes(2);

    // A deliberate later request is never blocked by the automatic retry cap.
    const explicitRetry = AssetManager.ensure('buff_root');
    expect(imageLoader).toHaveBeenCalledTimes(3);
    const image = { width: 64, explicitlyRetried: true };
    imageLoads.get(handle.url)?.resolve(image);
    await explicitRetry;

    expect(AssetManager.renderable(handle, 'Blitzcrank')).toBe(image);
  });
});
