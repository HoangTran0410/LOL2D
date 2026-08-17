import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KIT_ROSTER_VIEW_KEY,
  kitRosterView,
  loadKitRosterView,
  setKitRosterView,
} from '../../src/scenes/setup/kitRosterView';

/**
 * There is no jsdom here (see `tests/setup.ts`), so storage is a stub — the
 * same shape `zoomPreference.test.ts` installs. Kept to the four methods the
 * module actually calls, so a fifth one appearing in the source is a failure
 * rather than something the fake quietly absorbs.
 */
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

/**
 * The compact/expanded choice lives in a module, not in the editor component:
 * `LoadoutEditorModal` is mounted with `v-if` and `<script setup>` *is* the
 * setup function, so a `ref` at its top level is rebuilt on every open. It
 * also reaches `localStorage`, because "I want the grid" is a setting rather
 * than a fact about the last few seconds — the opposite call from
 * `panelTab.ts`, which deliberately does not persist.
 */
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', fakeStorage);
  kitRosterView.value = loadKitRosterView();
});
afterEach(() => {
  vi.unstubAllGlobals();
  store.clear();
});

describe('the roster remembers whether it was compact', () => {
  it('opens compact when nothing has been stored', () => {
    expect(loadKitRosterView()).toBe('compact');
  });

  it('reads back what was written', () => {
    setKitRosterView('expanded');
    expect(loadKitRosterView()).toBe('expanded');
    expect(kitRosterView.value).toBe('expanded');
  });

  it('falls back to compact on a value it does not recognise', () => {
    // Storage is editable by hand and survives a schema change; an unknown
    // string must not leave the roster in a third state that renders neither.
    store.set(KIT_ROSTER_VIEW_KEY, 'grid');
    expect(loadKitRosterView()).toBe('compact');
  });

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      ...fakeStorage,
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadKitRosterView()).toBe('compact');
    expect(() => setKitRosterView('expanded')).not.toThrow();
  });
});
