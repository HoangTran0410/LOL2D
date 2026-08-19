import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_COUNT_MAX,
  AI_COUNT_MIN,
  CDR_PERCENT_MAX,
  CDR_PERCENT_MIN,
  DEFAULT_PREGAME_CONFIG,
  SLOT_COUNT,
  loadPregameConfig,
  sanitizeChampionLoadout,
  sanitizePregameConfig,
  savePregameConfig,
  toMatchRules,
  type ChampionLoadout,
  type PregameConfig,
} from '../../../src/game/config/PregameConfig';
import TeamId from '../../../src/game/enums/TeamId';

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
    // Random champion + kit, 5 AI champions each also random with
    // AIChampion's own hardcoded defaults (autoMove off, autoAttack/autoCast
    // on), no cooldown reduction, full mana costs. Changing any of these is a
    // behaviour change for every player who has never opened the setup
    // screen.
    expect(DEFAULT_PREGAME_CONFIG.player).toEqual({
      mode: 'champion',
      championName: 'random',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: Array(SLOT_COUNT).fill('random'),
    });
    expect(DEFAULT_PREGAME_CONFIG.ai.count).toBe(3);
    expect(DEFAULT_PREGAME_CONFIG.ai.autoMove).toBe(true);
    expect(DEFAULT_PREGAME_CONFIG.ai.autoAttack).toBe(true);
    expect(DEFAULT_PREGAME_CONFIG.ai.autoCast).toBe(true);
    expect(DEFAULT_PREGAME_CONFIG.rules).toEqual({ cooldownReductionPercent: 0, manaFree: false });
  });

  it('gives every AI bot slot the same random-champion default as the player', () => {
    expect(DEFAULT_PREGAME_CONFIG.ai.bots).toHaveLength(AI_COUNT_MAX);
    for (const bot of DEFAULT_PREGAME_CONFIG.ai.bots) {
      expect(bot).toEqual(DEFAULT_PREGAME_CONFIG.player);
    }
  });

  it('gives every bot slot a stable alternating Red/Blue team', () => {
    expect(DEFAULT_PREGAME_CONFIG.ai.botTeams).toEqual(
      Array.from({ length: AI_COUNT_MAX }, (_, index) =>
        index % 2 === 0 ? TeamId.RED : TeamId.BLUE
      )
    );
  });

  it('starts the player on Blue, the fixed side before the team tab let them switch', () => {
    expect(DEFAULT_PREGAME_CONFIG.playerTeam).toBe(TeamId.BLUE);
  });

  it('produces a no-op match-rules multiplier', () => {
    expect(toMatchRules(DEFAULT_PREGAME_CONFIG.rules)).toEqual({
      cooldownMultiplier: 1,
      manaFree: false,
    });
  });
});

describe('sanitizeChampionLoadout', () => {
  it('falls back to a full default loadout for non-object input', () => {
    expect(sanitizeChampionLoadout(undefined)).toEqual(DEFAULT_PREGAME_CONFIG.player);
    expect(sanitizeChampionLoadout(null)).toEqual(DEFAULT_PREGAME_CONFIG.player);
    expect(sanitizeChampionLoadout('garbage')).toEqual(DEFAULT_PREGAME_CONFIG.player);
  });

  it('accepts a valid champion-mode loadout unchanged', () => {
    const loadout: ChampionLoadout = {
      mode: 'champion',
      championName: 'Yasuo',
      summonerD: 'Ghost',
      summonerF: 'Ignite',
      customSlots: Array(SLOT_COUNT).fill('random'),
    };
    expect(sanitizeChampionLoadout(loadout)).toEqual(loadout);
  });

  it('accepts a valid custom-mode loadout unchanged', () => {
    const loadout: ChampionLoadout = {
      mode: 'custom',
      championName: 'random',
      summonerD: 'Flash',
      summonerF: 'Heal',
      customSlots: ['BasicAttack', 'Yasuo_Q', 'random', 'Lux_R', 'random', 'Ghost', 'Heal'],
    };
    expect(sanitizeChampionLoadout(loadout)).toEqual(loadout);
  });

  it('falls back to "champion" for an unrecognized mode', () => {
    expect(sanitizeChampionLoadout({ mode: 'anything-else' }).mode).toBe('champion');
    expect(sanitizeChampionLoadout({}).mode).toBe('champion');
  });

  it('pads a short customSlots array with "random" up to SLOT_COUNT', () => {
    const result = sanitizeChampionLoadout({ customSlots: ['Yasuo_Q'] });
    expect(result.customSlots).toHaveLength(SLOT_COUNT);
    expect(result.customSlots[0]).toBe('Yasuo_Q');
    expect(result.customSlots.slice(1)).toEqual(Array(SLOT_COUNT - 1).fill('random'));
  });

  it('truncates a long customSlots array to SLOT_COUNT', () => {
    const result = sanitizeChampionLoadout({
      customSlots: Array.from({ length: SLOT_COUNT + 5 }, (_, i) => `Spell_${i}`),
    });
    expect(result.customSlots).toHaveLength(SLOT_COUNT);
    expect(result.customSlots[0]).toBe('Spell_0');
  });

  it('replaces a non-string customSlots entry with "random" rather than crashing', () => {
    const result = sanitizeChampionLoadout({
      customSlots: ['Yasuo_Q', 42, null, undefined, {}, [], 'Lux_R', 'extra-ignored'],
    });
    expect(result.customSlots).toEqual([
      'Yasuo_Q',
      'random',
      'random',
      'random',
      'random',
      'random',
      'Lux_R',
    ]);
  });

  it('falls back per-field for wrong-typed championName/summoners', () => {
    const result = sanitizeChampionLoadout({ championName: 42, summonerD: null, summonerF: {} });
    expect(result.championName).toBe('random');
    expect(result.summonerD).toBe('Flash');
    expect(result.summonerF).toBe('Heal');
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
      player: {
        mode: 'champion',
        championName: 'Yasuo',
        summonerD: 'Ghost',
        summonerF: 'Ignite',
        customSlots: Array(SLOT_COUNT).fill('random'),
      },
      playerTeam: TeamId.RED,
      ai: {
        count: 3,
        autoMove: true,
        autoAttack: false,
        autoCast: false,
        bots: Array.from({ length: AI_COUNT_MAX }, () => ({
          mode: 'champion' as const,
          championName: 'random' as const,
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: Array(SLOT_COUNT).fill('random'),
        })),
        botTeams: Array.from({ length: AI_COUNT_MAX }, (_, index) =>
          index % 2 === 0 ? TeamId.BLUE : TeamId.RED
        ),
        botBehaviours: Array.from({ length: AI_COUNT_MAX }, () => ({
          autoMove: true,
          autoAttack: false,
          autoCast: false,
        })),
      },
      rules: { cooldownReductionPercent: 40, manaFree: true },
      world: { jungle: false, minions: true },
      cheats: {
        revealMap: true,
        debug: {
          routes: true,
          terrain: false,
          collision: false,
          vision: false,
          quadtree: true,
          fps: false,
        },
        playerInvulnerable: true,
        botInvulnerable: Array.from({ length: AI_COUNT_MAX }, (_, index) => index === 1),
      },
    };
    expect(sanitizePregameConfig(custom)).toEqual(custom);
  });

  it('always produces exactly AI_COUNT_MAX bot slots, padding or truncating a mismatched ai.bots array', () => {
    expect(
      sanitizePregameConfig({ ai: { bots: [{ championName: 'Ahri' }] } }).ai.bots
    ).toHaveLength(AI_COUNT_MAX);
    expect(
      sanitizePregameConfig({
        ai: { bots: Array.from({ length: AI_COUNT_MAX + 4 }, () => ({ championName: 'Ahri' })) },
      }).ai.bots
    ).toHaveLength(AI_COUNT_MAX);
  });

  it('sanitizes each bot loadout independently, same rules as the player', () => {
    const result = sanitizePregameConfig({
      ai: {
        bots: [
          { championName: 'Ahri', summonerD: 'Ghost', summonerF: 'Ignite' },
          { mode: 'custom', customSlots: ['Yasuo_Q'] },
          'not an object',
        ],
      },
    });
    expect(result.ai.bots[0]).toEqual({
      mode: 'champion',
      championName: 'Ahri',
      summonerD: 'Ghost',
      summonerF: 'Ignite',
      customSlots: Array(SLOT_COUNT).fill('random'),
    });
    expect(result.ai.bots[1].mode).toBe('custom');
    expect(result.ai.bots[1].customSlots[0]).toBe('Yasuo_Q');
    expect(result.ai.bots[2]).toEqual(DEFAULT_PREGAME_CONFIG.player);
    // slots never explicitly provided still default to "today's behaviour"
    expect(result.ai.bots[3]).toEqual(DEFAULT_PREGAME_CONFIG.player);
  });
});

describe('toMatchRules', () => {
  it('turns a percentage into a multiplier', () => {
    expect(toMatchRules({ cooldownReductionPercent: 0, manaFree: false }).cooldownMultiplier).toBe(
      1
    );
    expect(toMatchRules({ cooldownReductionPercent: 50, manaFree: false }).cooldownMultiplier).toBe(
      0.5
    );
    expect(
      toMatchRules({ cooldownReductionPercent: 90, manaFree: false }).cooldownMultiplier
    ).toBeCloseTo(0.1);
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

  it('round-trips a saved config, including per-bot loadouts', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const custom: PregameConfig = {
      player: {
        mode: 'custom',
        championName: 'random',
        summonerD: 'Flash',
        summonerF: 'Heal',
        customSlots: ['BasicAttack', 'Yasuo_Q', 'Yasuo_W', 'Yasuo_E', 'Yasuo_R', 'Ghost', 'Ignite'],
      },
      playerTeam: TeamId.RED,
      ai: {
        count: 8,
        autoMove: true,
        autoAttack: true,
        autoCast: false,
        bots: Array.from({ length: AI_COUNT_MAX }, (_, i) => ({
          mode: 'champion' as const,
          championName: i === 0 ? 'Ahri' : ('random' as const),
          summonerD: 'Flash',
          summonerF: 'Heal',
          customSlots: Array(SLOT_COUNT).fill('random'),
        })),
        botTeams: Array.from({ length: AI_COUNT_MAX }, (_, index) =>
          index % 2 === 0 ? TeamId.RED : TeamId.BLUE
        ),
        botBehaviours: Array.from({ length: AI_COUNT_MAX }, (_, i) => ({
          autoMove: i === 0,
          autoAttack: true,
          autoCast: false,
        })),
      },
      rules: { cooldownReductionPercent: 30, manaFree: true },
      world: { jungle: true, minions: false },
      cheats: {
        revealMap: false,
        debug: {
          routes: false,
          terrain: true,
          collision: false,
          vision: true,
          quadtree: false,
          fps: true,
        },
        playerInvulnerable: false,
        botInvulnerable: Array.from({ length: AI_COUNT_MAX }, (_, index) => index === 3),
      },
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
      player: DEFAULT_PREGAME_CONFIG.player,
      ai: { ...DEFAULT_PREGAME_CONFIG.ai, count: 999 },
      rules: DEFAULT_PREGAME_CONFIG.rules,
    });
    expect(loadPregameConfig().ai.count).toBe(AI_COUNT_MAX);
  });

  // The schema-migration contract explicitly asked for: a config saved by
  // the version of this screen that shipped before per-bot configuration and
  // the free-form kit builder existed (no `player.mode`, no
  // `player.customSlots`, no `ai.bots`) must still load — with its old
  // fields honoured exactly as they meant before, and the new fields
  // defaulting to today's actual behaviour — not throw, and not silently
  // reset to defaults. This is why the storage key stayed
  // `lol2d:pregameConfig:v1` rather than bumping to v2: bumping the key
  // would have made this blob invisible instead of readable.
  it('loads a pre-existing v1 blob (no mode, no customSlots, no ai.bots) without error, preserving every old field', () => {
    const legacyV1Blob = {
      player: { championName: 'Zed', summonerD: 'Ghost', summonerF: 'Ignite' },
      ai: { count: 7, autoMove: true, autoAttack: false, autoCast: true },
      rules: { cooldownReductionPercent: 20, manaFree: true },
    };
    const storage = new MemoryStorage();
    storage.setItem('lol2d:pregameConfig:v1', JSON.stringify(legacyV1Blob));
    vi.stubGlobal('localStorage', storage);

    let loaded!: PregameConfig;
    expect(() => {
      loaded = loadPregameConfig();
    }).not.toThrow();

    // every old field preserved with its old meaning
    expect(loaded.player.championName).toBe('Zed');
    expect(loaded.player.summonerD).toBe('Ghost');
    expect(loaded.player.summonerF).toBe('Ignite');
    expect(loaded.ai.count).toBe(7);
    expect(loaded.ai.autoMove).toBe(true);
    expect(loaded.ai.autoAttack).toBe(false);
    expect(loaded.ai.autoCast).toBe(true);
    expect(loaded.rules.cooldownReductionPercent).toBe(20);
    expect(loaded.rules.manaFree).toBe(true);

    // new fields default to today's actual behaviour, not an error state
    expect(loaded.player.mode).toBe('champion');
    expect(loaded.player.customSlots).toEqual(Array(SLOT_COUNT).fill('random'));
    expect(loaded.ai.bots).toHaveLength(AI_COUNT_MAX);
    expect(
      loaded.ai.bots.every(bot => bot.mode === 'champion' && bot.championName === 'random')
    ).toBe(true);
    expect(loaded.ai.botTeams).toEqual(DEFAULT_PREGAME_CONFIG.ai.botTeams);
    // and the player, who had no team field before the team tab, migrates to Blue
    expect(loaded.playerTeam).toBe(TeamId.BLUE);
  });
});

describe('playerTeam', () => {
  it('migrates a missing player team to Blue', () => {
    expect(sanitizePregameConfig({ player: { championName: 'Zed' } }).playerTeam).toBe(TeamId.BLUE);
  });

  it('keeps a valid player team and falls back to Blue for an invalid one', () => {
    expect(sanitizePregameConfig({ playerTeam: TeamId.RED }).playerTeam).toBe(TeamId.RED);
    expect(sanitizePregameConfig({ playerTeam: 'legacy-ffa-id' }).playerTeam).toBe(TeamId.BLUE);
  });
});

describe('ai.botTeams', () => {
  it('migrates a missing array to the alternating default', () => {
    expect(sanitizePregameConfig({ ai: { count: 4 } }).ai.botTeams).toEqual(
      DEFAULT_PREGAME_CONFIG.ai.botTeams
    );
  });

  it('keeps valid teams and falls back per slot for invalid values', () => {
    const result = sanitizePregameConfig({
      ai: { botTeams: [TeamId.BLUE, TeamId.RED, 'legacy-ffa-id', null] },
    });

    expect(result.ai.botTeams).toHaveLength(AI_COUNT_MAX);
    expect(result.ai.botTeams.slice(0, 4)).toEqual([
      TeamId.BLUE,
      TeamId.RED,
      TeamId.RED,
      TeamId.BLUE,
    ]);
  });
});

/**
 * Per-bot behaviour, added when the practice panel started persisting what it
 * edits: the panel sets `autoMove`/`autoAttack`/`autoCast` per bot, where the
 * setup screen only ever set them globally, so the config needs somewhere to
 * put a per-bot answer.
 */
describe('ai.botBehaviours', () => {
  it('defaults to one entry per slot carrying AIChampion’s own defaults', () => {
    expect(DEFAULT_PREGAME_CONFIG.ai.botBehaviours).toHaveLength(AI_COUNT_MAX);
    for (const behaviour of DEFAULT_PREGAME_CONFIG.ai.botBehaviours) {
      expect(behaviour).toEqual({ autoMove: true, autoAttack: true, autoCast: true });
    }
  });

  // The migration decision, and the one that is easy to get wrong: a stored
  // config written before this array existed must hand every slot *the
  // player's own* global choice. Seeding from DEFAULT_PREGAME_CONFIG instead
  // would look like it works — the defaults are a plausible answer — while
  // silently discarding a setting the player really made on the setup screen.
  it('seeds a missing array from the stored global flags, not from DEFAULT_PREGAME_CONFIG', () => {
    const globals = { autoMove: true, autoAttack: false, autoCast: false };
    const result = sanitizePregameConfig({ ai: { count: 3, ...globals } });

    expect(result.ai.botBehaviours).toHaveLength(AI_COUNT_MAX);
    for (const behaviour of result.ai.botBehaviours) expect(behaviour).toEqual(globals);
    // Stated as its own assertion because it is the actual regression: every
    // one of these differs from the default.
    expect(result.ai.botBehaviours[0]).not.toEqual(DEFAULT_PREGAME_CONFIG.ai.botBehaviours[0]);
  });

  it('pads a short array from the global flags and truncates a long one', () => {
    const globals = { autoMove: true, autoAttack: false, autoCast: true };
    const result = sanitizePregameConfig({
      ai: { ...globals, botBehaviours: [{ autoMove: false, autoAttack: true, autoCast: false }] },
    });

    expect(result.ai.botBehaviours).toHaveLength(AI_COUNT_MAX);
    expect(result.ai.botBehaviours[0]).toEqual({
      autoMove: false,
      autoAttack: true,
      autoCast: false,
    });
    expect(result.ai.botBehaviours[1]).toEqual(globals);

    expect(
      sanitizePregameConfig({
        ai: { botBehaviours: Array.from({ length: AI_COUNT_MAX + 4 }, () => globals) },
      }).ai.botBehaviours
    ).toHaveLength(AI_COUNT_MAX);
  });

  it('falls back per field, to the global flag, for a wrong-typed entry', () => {
    const globals = { autoMove: true, autoAttack: false, autoCast: true };
    const result = sanitizePregameConfig({
      ai: { ...globals, botBehaviours: [{ autoMove: 'yes', autoCast: false }, 'not an object'] },
    });

    expect(result.ai.botBehaviours[0]).toEqual({
      autoMove: true, // 'yes' is not a boolean -> the global
      autoAttack: false, // absent -> the global
      autoCast: false, // a real boolean -> kept
    });
    expect(result.ai.botBehaviours[1]).toEqual(globals);
  });
});

/**
 * The world section: whether the jungle and the lane minions exist. New here
 * because the practice panel is the only screen that has ever had these
 * switches, and persisting the panel means the config needs a home for them.
 */
describe('world', () => {
  it('defaults to both on, i.e. the match every version before this one booted', () => {
    expect(DEFAULT_PREGAME_CONFIG.world).toEqual({ jungle: true, minions: true });
  });

  it('reads a stored world section and falls back per field', () => {
    expect(sanitizePregameConfig({ world: { jungle: false, minions: false } }).world).toEqual({
      jungle: false,
      minions: false,
    });
    expect(sanitizePregameConfig({ world: { jungle: false } }).world).toEqual({
      jungle: false,
      minions: true,
    });
    expect(sanitizePregameConfig({ world: 'garbage' }).world).toEqual(DEFAULT_PREGAME_CONFIG.world);
  });

  it('gives a config saved before this section existed a full jungle and lane minions', () => {
    expect(sanitizePregameConfig({ ai: { count: 2 } }).world).toEqual({
      jungle: true,
      minions: true,
    });
  });

  it('round-trips through storage', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    savePregameConfig({
      ...DEFAULT_PREGAME_CONFIG,
      world: { jungle: false, minions: true },
    });
    expect(loadPregameConfig().world).toEqual({ jungle: false, minions: true });
  });
});

/**
 * The `cheats` branch, added when the setup screen and the practice panel
 * became one panel and every setting it holds became persistent.
 *
 * The migration case is the one that matters: a blob saved before this section
 * existed meant a match with nothing switched on, because nothing could be
 * switched on across a reload. All-`false` is a lossless read of that, not a
 * reset — the same per-field policy the rest of this validator follows.
 */
describe('cheats', () => {
  const ALL_OFF = {
    revealMap: false,
    debug: {
      routes: false,
      terrain: false,
      collision: false,
      vision: false,
      quadtree: false,
      fps: false,
    },
    playerInvulnerable: false,
    botInvulnerable: Array.from({ length: AI_COUNT_MAX }, () => false),
  };

  it('defaults to nothing switched on', () => {
    expect(DEFAULT_PREGAME_CONFIG.cheats).toEqual(ALL_OFF);
  });

  it('gives a config saved before this section existed everything off', () => {
    expect(sanitizePregameConfig({ ai: { count: 2 } }).cheats).toEqual(ALL_OFF);
  });

  it('falls back per field rather than dropping the whole section', () => {
    const cheats = sanitizePregameConfig({
      cheats: { revealMap: true, debug: { terrain: true } },
    }).cheats;
    expect(cheats.revealMap).toBe(true);
    expect(cheats.debug).toEqual({ ...ALL_OFF.debug, terrain: true });
    expect(cheats.playerInvulnerable).toBe(false);
  });

  it('coerces botInvulnerable to exactly AI_COUNT_MAX entries', () => {
    const short = sanitizePregameConfig({ cheats: { botInvulnerable: [true] } }).cheats;
    expect(short.botInvulnerable).toHaveLength(AI_COUNT_MAX);
    expect(short.botInvulnerable[0]).toBe(true);
    expect(short.botInvulnerable[1]).toBe(false);

    const long = sanitizePregameConfig({
      cheats: { botInvulnerable: Array.from({ length: AI_COUNT_MAX + 5 }, () => true) },
    }).cheats;
    expect(long.botInvulnerable).toHaveLength(AI_COUNT_MAX);

    const junk = sanitizePregameConfig({ cheats: { botInvulnerable: 'nope' } }).cheats;
    expect(junk.botInvulnerable).toEqual(ALL_OFF.botInvulnerable);
  });

  it('round-trips through storage', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    const botInvulnerable = Array.from({ length: AI_COUNT_MAX }, (_, i) => i === 2);
    savePregameConfig({
      ...DEFAULT_PREGAME_CONFIG,
      cheats: {
        revealMap: true,
        debug: { routes: true, terrain: false, collision: false, vision: true, quadtree: false },
        playerInvulnerable: true,
        botInvulnerable,
      },
    });
    const back = loadPregameConfig().cheats;
    expect(back.revealMap).toBe(true);
    expect(back.debug.routes).toBe(true);
    expect(back.debug.vision).toBe(true);
    expect(back.debug.terrain).toBe(false);
    expect(back.playerInvulnerable).toBe(true);
    expect(back.botInvulnerable[2]).toBe(true);
    expect(back.botInvulnerable[0]).toBe(false);
  });
});
