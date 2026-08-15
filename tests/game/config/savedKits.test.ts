import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVED_KITS_STORAGE_KEY,
  SAVED_KIT_NAME_MAX,
  deleteKit,
  loadSavedKits,
  renameKit,
  saveKit,
} from '../../../src/game/config/savedKits';
import type { ChampionLoadout } from '../../../src/game/config/PregameConfig';

/**
 * A minimal in-memory `localStorage` so persistence can be tested in node —
 * the same stub `PregameConfig.test.ts` uses, for the same reason: this
 * vitest environment is `node` (see `vitest.config.ts`), which has no ambient
 * `localStorage` at all.
 */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const LOADOUT: ChampionLoadout = {
  mode: 'custom',
  championName: 'random',
  summonerD: 'Flash',
  summonerF: 'Heal',
  customSlots: ['BasicAttack', 'Ahri_Q', 'Yasuo_W', 'Zed_E', 'Lux_R', 'Flash', 'Heal'],
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('savedKits', () => {
  it('round-trips a kit', () => {
    const saved = saveKit('Zed tàng hình', LOADOUT);
    expect(saved.name).toBe('Zed tàng hình');
    expect(saved.loadout).toEqual(LOADOUT);
    expect(saved.id).toBeTruthy();
    expect(saved.savedAt).toBeGreaterThan(0);

    expect(loadSavedKits()).toEqual([saved]);
  });

  it('keeps kits newest first', () => {
    const first = saveKit('A', LOADOUT);
    const second = saveKit('B', LOADOUT);
    expect(loadSavedKits().map(k => k.id)).toEqual([second.id, first.id]);
  });

  it('renames and deletes by id', () => {
    const kit = saveKit('old', LOADOUT);
    renameKit(kit.id, 'new');
    expect(loadSavedKits()[0].name).toBe('new');

    deleteKit(kit.id);
    expect(loadSavedKits()).toEqual([]);
  });

  it('ignores a rename or delete for an id that is not there', () => {
    saveKit('keep', LOADOUT);
    renameKit('nope', 'x');
    deleteKit('nope');
    expect(loadSavedKits()).toHaveLength(1);
  });

  it('trims and caps a name, and refuses an empty one', () => {
    const kit = saveKit(`  ${'x'.repeat(SAVED_KIT_NAME_MAX + 20)}  `, LOADOUT);
    expect(kit.name).toHaveLength(SAVED_KIT_NAME_MAX);
    expect(() => saveKit('   ', LOADOUT)).toThrow();
  });

  it('copies the loadout, so editing the caller’s draft afterwards cannot rewrite the save', () => {
    const draft: ChampionLoadout = { ...LOADOUT, customSlots: [...LOADOUT.customSlots] };
    const kit = saveKit('snapshot', draft);

    (draft.customSlots as string[])[1] = 'Yasuo_Q';
    draft.championName = 'Ahri';

    expect(kit.loadout.customSlots[1]).toBe('Ahri_Q');
    expect(loadSavedKits()[0].loadout.customSlots[1]).toBe('Ahri_Q');
    expect(loadSavedKits()[0].loadout.championName).toBe('random');
  });

  it('reads a corrupt blob as an empty library rather than throwing', () => {
    localStorage.setItem(SAVED_KITS_STORAGE_KEY, '{not json');
    expect(loadSavedKits()).toEqual([]);
  });

  it('reads valid JSON of the wrong shape as an empty library', () => {
    localStorage.setItem(SAVED_KITS_STORAGE_KEY, JSON.stringify({ totally: 'unrelated' }));
    expect(loadSavedKits()).toEqual([]);
  });

  it('drops a malformed entry and keeps the sound ones', () => {
    const good = saveKit('good', LOADOUT);
    const raw = JSON.parse(localStorage.getItem(SAVED_KITS_STORAGE_KEY)!);
    raw.push({ id: 'bad', name: 'bad' }); // no loadout
    raw.push({ id: 'bad2', loadout: LOADOUT }); // no name
    raw.push({ id: 'bad3', name: 'bad3', savedAt: 1, loadout: { ...LOADOUT, customSlots: [] } }); // wrong slot count
    raw.push(null);
    localStorage.setItem(SAVED_KITS_STORAGE_KEY, JSON.stringify(raw));

    expect(loadSavedKits().map(k => k.id)).toEqual([good.id]);
  });

  it('never touches the pregame config key', () => {
    saveKit('a', LOADOUT);
    renameKit(loadSavedKits()[0].id, 'b');
    deleteKit(loadSavedKits()[0].id);
    expect(localStorage.getItem('lol2d:pregameConfig:v1')).toBeNull();
  });

  it('survives localStorage being unavailable entirely', () => {
    // No stub at all — a browser with storage disabled, or private-mode
    // Safari. Losing the library is acceptable; taking the screen down is not.
    vi.unstubAllGlobals();
    expect(() => loadSavedKits()).not.toThrow();
    expect(loadSavedKits()).toEqual([]);
    expect(() => saveKit('a', LOADOUT)).not.toThrow();
    expect(() => renameKit('a', 'b')).not.toThrow();
    expect(() => deleteKit('a')).not.toThrow();
  });
});
