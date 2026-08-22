/**
 * `trackDownloadingUpdate` is the one piece of `src/pwa/updates.ts` with real
 * branching — everything else in that file is either a plain ref or the
 * `virtual:pwa-register` wiring, which does not exist outside a real build
 * (see the module's own header comment). A fake "installing worker" object
 * is enough to drive every transition without a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { UPDATE_DOWNLOAD_STALL_MS, trackDownloadingUpdate, updateDownloading } from '@/pwa/updates';

function fakeInstallingWorker() {
  let state = 'installing';
  const listeners: Array<() => void> = [];
  return {
    get state() {
      return state;
    },
    addEventListener(type: 'statechange', listener: () => void) {
      if (type === 'statechange') listeners.push(listener);
    },
    setState(next: string) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/** A controllable stand-in for `setTimeout`/`clearTimeout`, fired by hand. */
function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimeoutFn: ((fn: () => void) => {
      const id = nextId++;
      pending.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: ((id: unknown) => {
      pending.delete(id as number);
    }) as typeof clearTimeout,
    fire(id: number) {
      pending.get(id)?.();
    },
    has(id: number) {
      return pending.has(id);
    },
  };
}

describe('trackDownloadingUpdate', () => {
  beforeEach(() => {
    updateDownloading.value = false;
  });

  it('lights updateDownloading as soon as an install starts', () => {
    trackDownloadingUpdate(fakeInstallingWorker());
    expect(updateDownloading.value).toBe(true);
  });

  it('clears updateDownloading once the worker finishes installing', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    worker.setState('installed');
    expect(updateDownloading.value).toBe(false);
  });

  it('clears updateDownloading if the worker is dropped as redundant', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    worker.setState('redundant');
    expect(updateDownloading.value).toBe(false);
  });

  it('does not clear updateDownloading on a non-terminal statechange', () => {
    const worker = fakeInstallingWorker();
    trackDownloadingUpdate(worker);
    worker.setState('installing');
    expect(updateDownloading.value).toBe(true);
  });

  it('gives up after the stall timeout if the install never resolves', () => {
    const worker = fakeInstallingWorker();
    const timers = fakeTimers();
    trackDownloadingUpdate(worker, timers.setTimeoutFn, timers.clearTimeoutFn);
    expect(updateDownloading.value).toBe(true);
    timers.fire(1);
    expect(updateDownloading.value).toBe(false);
  });

  it('cancels the stall timeout once the worker finishes first', () => {
    const worker = fakeInstallingWorker();
    const timers = fakeTimers();
    trackDownloadingUpdate(worker, timers.setTimeoutFn, timers.clearTimeoutFn);
    worker.setState('installed');
    expect(timers.has(1)).toBe(false);
  });
});

describe('UPDATE_DOWNLOAD_STALL_MS', () => {
  it('is a positive tuning value', () => {
    expect(UPDATE_DOWNLOAD_STALL_MS).toBeGreaterThan(0);
  });
});
