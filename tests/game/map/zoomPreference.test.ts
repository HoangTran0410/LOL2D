import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setZoomFactorPreference,
  zoomFactorPreference,
} from '../../../src/game/gameObject/map/Camera';

const withEnv = (search: string, stored: string | null, touchStored: string | null = null) => {
  const store = new Map<string, string>();
  if (stored !== null) store.set('lol2d.zoomFactor', stored);
  if (touchStored !== null) store.set('lol2d.zoomFactor.touch', touchStored);
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  return store;
};

afterEach(() => vi.unstubAllGlobals());

describe('zoomFactorPreference', () => {
  it('defaults to 1 with no query and no stored value', () => {
    withEnv('', null);
    expect(zoomFactorPreference()).toBe(1);
  });

  it('reads the stored value', () => {
    withEnv('', '1.3');
    expect(zoomFactorPreference()).toBeCloseTo(1.3, 5);
  });

  // The override is what lets an e2e run pin a zoom; it must beat storage, or
  // a developer's own stored preference would change what the suite measures.
  it('the query overrides the stored value', () => {
    withEnv('?zoom=0.8', '1.5');
    expect(zoomFactorPreference()).toBeCloseTo(0.8, 5);
  });

  it('clamps both sources into the manual range', () => {
    withEnv('?zoom=99', null);
    expect(zoomFactorPreference()).toBe(1.6);
    withEnv('', '0.01');
    expect(zoomFactorPreference()).toBe(0.6);
  });

  it('ignores junk rather than producing NaN', () => {
    withEnv('?zoom=banana', null);
    expect(zoomFactorPreference()).toBe(1);
    withEnv('', 'banana');
    expect(zoomFactorPreference()).toBe(1);
  });

  it('round-trips through storage', () => {
    const store = withEnv('', null);
    setZoomFactorPreference(1.2);
    expect(store.get('lol2d.zoomFactor')).toBe('1.2');
    expect(zoomFactorPreference()).toBeCloseTo(1.2, 5);
  });

  it('uses a separate 100% default for touch instead of inheriting an old desktop zoom', () => {
    withEnv('', '0.6');

    expect(zoomFactorPreference(true)).toBe(1);
  });

  it('round-trips the touch preference through its own key', () => {
    const store = withEnv('', '0.8');

    setZoomFactorPreference(1.3, true);

    expect(store.get('lol2d.zoomFactor.touch')).toBe('1.3');
    expect(store.get('lol2d.zoomFactor')).toBe('0.8');
    expect(zoomFactorPreference(true)).toBeCloseTo(1.3, 5);
  });

  it('keeps the query override highest-priority in touch mode', () => {
    withEnv('?zoom=1.4', '0.7', '0.9');

    expect(zoomFactorPreference(true)).toBeCloseTo(1.4, 5);
  });
});
