/**
 * Fullscreen and the landscape lock, which are one feature wearing two APIs.
 *
 * The reason this is tested at all is that both of them are *absent* on the
 * device the feature exists for. iPhone Safari has no Fullscreen API outside
 * `<video>` and no `screen.orientation.lock`, so every branch here has a
 * "there is nothing to call" path, and each one is a silent no-op when it is
 * right and a crashed HUD when it is wrong. Chrome on Android has both but
 * only honours the lock *while fullscreen*, which is why the lock is chained
 * onto the request rather than fired beside it — the one ordering fact worth
 * pinning, because nothing about it is visible at the call site.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import DomUtils from '../../src/utils/dom.utils';

type Stubbed = {
  requestFullscreen?: unknown;
  webkitRequestFullscreen?: unknown;
  fullscreenElement?: unknown;
  exitFullscreen?: unknown;
};

/** Installs a `document`/`screen` pair with only the APIs a device really has. */
const device = (options: {
  fullscreen?: 'standard' | 'webkit' | 'none';
  /** Whether requestFullscreen resolves a promise, as modern browsers do. */
  async?: boolean;
  orientation?: 'lockable' | 'present' | 'none';
}) => {
  const calls = { requested: 0, exited: 0, locked: [] as string[], unlocked: 0 };
  let resolveRequest: (() => void) | undefined;

  const request = vi.fn(() => {
    calls.requested++;
    if (!options.async) return undefined;
    return new Promise<void>(resolve => {
      resolveRequest = resolve;
    });
  });

  const element: Stubbed = {};
  if (options.fullscreen === 'standard') element.requestFullscreen = request;
  if (options.fullscreen === 'webkit') element.webkitRequestFullscreen = request;

  vi.stubGlobal('document', {
    documentElement: element,
    fullscreenElement: null,
    exitFullscreen: () => {
      calls.exited++;
    },
  });

  const orientation =
    options.orientation === 'none'
      ? undefined
      : {
          lock:
            options.orientation === 'lockable'
              ? (value: string) => {
                  calls.locked.push(value);
                  return Promise.resolve();
                }
              : undefined,
          unlock: () => {
            calls.unlocked++;
          },
        };
  vi.stubGlobal('screen', orientation ? { orientation } : {});

  return { calls, settle: () => resolveRequest?.() };
};

afterEach(() => vi.unstubAllGlobals());

describe('fullscreenSupported', () => {
  it('is false on a browser that exposes no request method — the iPhone case', () => {
    device({ fullscreen: 'none' });
    // This is what decides whether the practice panel draws the button at all.
    // A control that can never work is worse than no control.
    expect(DomUtils.fullscreenSupported()).toBe(false);
  });

  it('is true behind a vendor prefix as well as the standard name', () => {
    device({ fullscreen: 'webkit' });
    expect(DomUtils.fullscreenSupported()).toBe(true);
  });
});

describe('goFullscreen', () => {
  it('locks landscape only once the request has resolved', async () => {
    // The ordering that matters: Android refuses an orientation lock until the
    // document is actually fullscreen, so a lock fired beside the request —
    // rather than chained onto it — silently does nothing.
    const { calls, settle } = device({
      fullscreen: 'standard',
      async: true,
      orientation: 'lockable',
    });

    DomUtils.goFullscreen();
    expect(calls.requested).toBe(1);
    expect(calls.locked).toEqual([]);

    settle();
    // A macrotask, not a counted number of microtask hops: how many the chain
    // takes is an implementation detail, and the assertion above is what
    // actually pins the ordering.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls.locked).toEqual(['landscape']);
  });

  it('locks immediately when the request returns nothing to wait on', () => {
    const { calls } = device({ fullscreen: 'webkit', orientation: 'lockable' });
    DomUtils.goFullscreen();
    expect(calls.locked).toEqual(['landscape']);
  });

  it('calls exactly one request method when several are present', () => {
    const { calls } = device({ fullscreen: 'standard', orientation: 'none' });
    (document.documentElement as unknown as Stubbed).webkitRequestFullscreen = () => {
      calls.requested += 100;
    };

    DomUtils.goFullscreen();
    expect(calls.requested).toBe(1);
  });

  it('does nothing at all where there is no request method', () => {
    const { calls } = device({ fullscreen: 'none', orientation: 'lockable' });
    expect(() => DomUtils.goFullscreen()).not.toThrow();
    expect(calls.requested).toBe(0);
    // and no lock either: unlocked-but-fullscreen is a state to avoid asking for
    expect(calls.locked).toEqual([]);
  });
});

describe('lockLandscape', () => {
  it('is a no-op where the API is missing entirely', () => {
    device({ fullscreen: 'standard', orientation: 'none' });
    expect(() => DomUtils.lockLandscape()).not.toThrow();
  });

  it('swallows a rejection, which is the normal answer on half of all devices', async () => {
    device({ fullscreen: 'standard', orientation: 'present' });
    vi.stubGlobal('screen', {
      orientation: { lock: () => Promise.reject(new Error('NotSupportedError')) },
    });

    expect(() => DomUtils.lockLandscape()).not.toThrow();
    // an unhandled rejection would fail the run on the next tick
    await Promise.resolve();
  });

  it('swallows a synchronous throw, which is how Safari refuses', () => {
    vi.stubGlobal('screen', {
      orientation: {
        lock: () => {
          throw new Error('NotSupportedError');
        },
      },
    });

    expect(() => DomUtils.lockLandscape()).not.toThrow();
  });
});

describe('exitFullscreen', () => {
  it('releases the orientation lock on the way out', () => {
    const { calls } = device({ fullscreen: 'standard', orientation: 'lockable' });
    DomUtils.exitFullscreen();
    expect(calls.unlocked).toBe(1);
    expect(calls.exited).toBe(1);
  });
});
