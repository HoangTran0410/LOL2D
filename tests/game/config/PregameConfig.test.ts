import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_COUNT_MAX,
  AI_COUNT_MIN,
  CDR_PERCENT_MAX,
  CDR_PERCENT_MIN,
  DEFAULT_PREGAME_CONFIG,
  loadPregameConfig,
  sanitizePregameConfig,
  savePregameConfig,
  toMatchRules,
  type PregameConfig,
} from '../../../src/game/config/PregameConfig';

/** A minimal in-memory `localStorage` so persistence can be tested in node. */
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DEFAULT_PREGAME_CONFIG', () => {
  it('reproduces the game exactly as it behaved before this config existed', () => {
    // Random champion + kit, 5 AI champions with AIChampion's own hardcoded
    // defaults (autoMove off, autoAttack/autoCast on), no cooldown reduction,
    // full mana costs. Changing any of these is a behaviour change for every
    // player who has never opened the setup screen.
    expect(DEFAULT_PREGAME_CONFIG).toEqual({
      player: { championName: 'random', summonerD: 'Flash', summonerF: 'Heal' },
      ai: { count: 5, autoMove: false, autoAttack: true, autoCast: true },
      rules: { cooldownReductionPercent: 0, manaFree: false },
    });
  });

  it('produces a no-op match-rules multiplier', () => {
    expect(toMatchRules(DEFAULT_PREGAME_CONFIG.rules)).toEqual({
      cooldownMultiplier: 1,
      manaFree: false,
    });
  });
});

describe('sanitizePregameConfig', () => {
  it('falls back to defaults for non-object input', () => {
    expect(sanitizePregameConfig(undefined)).toEqual(DEFAULT_PREGAME_CONFIG);
    expect(sanitizePregameConfig(null)).toEqual(DEFAULT_PREGAME_CONFIG);
    expect(sanitizePregameConfig('garbage')).toEqual(DEFAULT_PREGAME_CONFIG);
    expect(sanitizePregameConfig(42)).toEqual(DEFAULT_PREGAME_CONFIG);
    expect(sanitizePregameConfig([])).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('falls back to defaults for an empty object', () => {
    expect(sanitizePregameConfig({})).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('fills in missing sections independently', () => {
    const result = sanitizePregameConfig({ ai: { count: 8 } });
    expect(result.ai.count).toBe(8);
    expect(result.ai.autoMove).toBe(DEFAULT_PREGAME_CONFIG.ai.autoMove);
    expect(result.player).toEqual(DEFAULT_PREGAME_CONFIG.player);
    expect(result.rules).toEqual(DEFAULT_PREGAME_CONFIG.rules);
  });

  it('clamps an out-of-range AI count instead of accepting or throwing', () => {
    expect(sanitizePregameConfig({ ai: { count: -5 } }).ai.count).toBe(AI_COUNT_MIN);
    expect(sanitizePregameConfig({ ai: { count: 999 } }).ai.count).toBe(AI_COUNT_MAX);
    expect(sanitizePregameConfig({ ai: { count: 7.6 } }).ai.count).toBe(8);
  });

  it('clamps an out-of-range cooldown reduction percent', () => {
    expect(
      sanitizePregameConfig({ rules: { cooldownReductionPercent: -20 } }).rules
        .cooldownReductionPercent
    ).toBe(CDR_PERCENT_MIN);
    expect(
      sanitizePregameConfig({ rules: { cooldownReductionPercent: 500 } }).rules
        .cooldownReductionPercent
    ).toBe(CDR_PERCENT_MAX);
  });

  it('falls back to defaults for fields of the wrong type rather than coercing them', () => {
    const result = sanitizePregameConfig({
      player: { championName: 42, summonerD: null, summonerF: {} },
      ai: { count: 'five', autoMove: 'yes', autoAttack: 1, autoCast: undefined },
      rules: { cooldownReductionPercent: 'lots', manaFree: 'true' },
    });
    expect(result).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('survives a completely garbled blob — the shape localStorage.getItem returns after manual editing or a version bump', () => {
    const garbled = {
      player: 'not an object',
      ai: null,
      rules: [1, 2, 3],
      someUnrelatedFutureField: { nested: true },
    };
    expect(() => sanitizePregameConfig(garbled)).not.toThrow();
    expect(sanitizePregameConfig(garbled)).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('keeps a fully valid custom config unchanged', () => {
    const custom: PregameConfig = {
      player: { championName: 'Yasuo', summonerD: 'Ghost', summonerF: 'Ignite' },
      ai: { count: 3, autoMove: true, autoAttack: false, autoCast: false },
      rules: { cooldownReductionPercent: 40, manaFree: true },
    };
    expect(sanitizePregameConfig(custom)).toEqual(custom);
  });
});

describe('toMatchRules', () => {
  it('turns a percentage into a multiplier', () => {
    expect(toMatchRules({ cooldownReductionPercent: 0, manaFree: false }).cooldownMultiplier).toBe(1);
    expect(toMatchRules({ cooldownReductionPercent: 50, manaFree: false }).cooldownMultiplier).toBe(
      0.5
    );
    expect(toMatchRules({ cooldownReductionPercent: 90, manaFree: false }).cooldownMultiplier).toBeCloseTo(
      0.1
    );
  });

  it('passes manaFree through unchanged', () => {
    expect(toMatchRules({ cooldownReductionPercent: 0, manaFree: true }).manaFree).toBe(true);
  });
});

describe('loadPregameConfig / savePregameConfig', () => {
  it('returns defaults when localStorage has nothing saved', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    expect(loadPregameConfig()).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('round-trips a saved config', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const custom: PregameConfig = {
      player: { championName: 'Ahri', summonerD: 'Flash', summonerF: 'Heal' },
      ai: { count: 8, autoMove: true, autoAttack: true, autoCast: false },
      rules: { cooldownReductionPercent: 30, manaFree: true },
    };
    savePregameConfig(custom);
    expect(loadPregameConfig()).toEqual(custom);
  });

  it('falls back to defaults instead of throwing when the stored blob is not JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem('lol2d:pregameConfig:v1', '{not json at all');
    vi.stubGlobal('localStorage', storage);
    expect(() => loadPregameConfig()).not.toThrow();
    expect(loadPregameConfig()).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('falls back to defaults instead of throwing when the stored blob is valid JSON but the wrong shape', () => {
    const storage = new MemoryStorage();
    storage.setItem('lol2d:pregameConfig:v1', JSON.stringify({ totally: 'unrelated' }));
    vi.stubGlobal('localStorage', storage);
    expect(loadPregameConfig()).toEqual(DEFAULT_PREGAME_CONFIG);
  });

  it('falls back to defaults instead of throwing when localStorage is unavailable', () => {
    // No stub at all — this vitest environment is `node`, which has no
    // ambient `localStorage`, exactly like a browser with it disabled would.
    expect(() => loadPregameConfig()).not.toThrow();
    expect(loadPregameConfig()).toEqual(DEFAULT_PREGAME_CONFIG);
    expect(() => savePregameConfig(DEFAULT_PREGAME_CONFIG)).not.toThrow();
  });

  it('sanitizes before saving, so an invalid in-memory value can never be persisted', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    savePregameConfig({
      player: { championName: 'random', summonerD: 'Flash', summonerF: 'Heal' },
      ai: { count: 999, autoMove: false, autoAttack: true, autoCast: true },
      rules: { cooldownReductionPercent: 0, manaFree: false },
    });
    expect(loadPregameConfig().ai.count).toBe(AI_COUNT_MAX);
  });
});
