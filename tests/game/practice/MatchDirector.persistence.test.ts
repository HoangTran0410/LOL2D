import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import {
  AI_COUNT_MAX,
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_PREGAME_CONFIG,
  loadPregameConfig,
  savePregameConfig,
  type ChampionLoadout,
} from '../../../src/game/config/PregameConfig';
import TeamId from '../../../src/game/enums/TeamId';
import { context } from './helpers';

/**
 * The panel writes `lol2d:pregameConfig:v1` now.
 *
 * It used to write nothing at all — "chỉ sửa trận hiện tại", mutate the running
 * match and leave the setup screen's storage alone. The
 * `2026-08-16-panel-persistence-design` spec reversed that for match
 * configuration: the panel is a strict superset of the setup screen for
 * everything except input mode, so the surface whose work survived a reload was
 * the weaker of the two.
 *
 * What this suite is actually guarding is the *edge* of that reversal. Match
 * configuration persists; session state — every cheat, every debug layer — must
 * not, and the line has to hold against a later change that widens the hook
 * without thinking about it.
 */

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

const STORAGE_KEY = 'lol2d:pregameConfig:v1';
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

/** The raw blob, so a test can assert on the *keys* that were written and not only the values. */
const storedRaw = (): Record<string, unknown> | null => {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
};

const loadoutNamed = (championName: string): ChampionLoadout => ({
  ...DEFAULT_CHAMPION_LOADOUT,
  championName,
});

/** The bench, with the player's loadout seeded the way `Game`'s constructor seeds it. */
const bench = (): { director: MatchDirector; ctx: ReturnType<typeof context>['context'] } => {
  const { context: ctx, player } = context();
  const director = new MatchDirector(ctx);
  director.seedLoadout(player, loadoutNamed('Veigar'));
  return { director, ctx };
};

describe('MatchDirector persistence', () => {
  it('writes nothing until something is actually changed', () => {
    bench();
    expect(storedRaw()).toBeNull();
  });

  /**
   * Task 10's own edge: a chosen map is a *next-match* setting, never a live
   * mutation — nothing here rebuilds terrain, a nav grid or a spawned camp.
   * `mapChoice` is what proves the choice actually lives on the director
   * (`toPregameConfig()` reads `this._mapChoice`, not anything derived from a
   * `Game`, which this bench has none of anyway) rather than being lost the
   * moment some other setter's `persist()` runs.
   */
  describe('map choice', () => {
    it('persists the chosen map, qualified, and nothing else moves', () => {
      const { director } = bench();
      director.setMapChoice('reference:proving-grounds');

      expect(director.mapChoice).toBe('reference:proving-grounds');
      expect(loadPregameConfig().mapId).toBe('reference:proving-grounds');
    });

    it('carries a seeded choice through a later, unrelated write', () => {
      const { director } = bench();
      director.seedMapChoice('reference:proving-grounds');

      // Some other control writes storage; the seeded (never explicitly
      // "set") map choice must ride along rather than reverting to the
      // module default `toPregameConfig()` would fall back to if
      // `_mapChoice` had never been told what the match actually booted on.
      director.setRules({ cooldownReductionPercent: 20, manaFree: false });

      expect(loadPregameConfig().mapId).toBe('reference:proving-grounds');
    });
  });

  // The round trip the spec asks for, minus its second half: booting a real
  // `Game` from the result needs a canvas, an asset manager and p5's globals,
  // so that half lives in `tests/e2e/drive-practice-panel.mjs`, which reloads
  // the page into a new match and asserts the match it gets.
  it('persists a per-bot flag, a rules change and the world switches', () => {
    const { director } = bench();

    const bot = director.addBot(loadoutNamed('Ahri'))!;
    director.setBotBehaviour(bot, { autoMove: true });
    director.setRules({ cooldownReductionPercent: 40, manaFree: true });
    director.jungleEnabled = false;
    director.minionsEnabled = false;

    const stored = loadPregameConfig();
    expect(stored.player.championName).toBe('Veigar');
    expect(stored.ai.count).toBe(1);
    expect(stored.ai.bots[0].championName).toBe('Ahri');
    expect(stored.ai.botTeams[0]).toBe(TeamId.RED);
    expect(stored.ai.botBehaviours[0]).toEqual({
      autoMove: true,
      autoAttack: true,
      autoCast: true,
      difficulty: 'normal',
    });
    expect(stored.rules).toEqual({ cooldownReductionPercent: 40, manaFree: true });
    expect(stored.world).toEqual({ jungle: false, minions: false });
  });

  it('persists a champion swap, for the player as readily as for a bot', () => {
    const { director, ctx } = bench();
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    director.applyLoadout(ctx.player, loadoutNamed('Zed'));
    director.applyLoadout(bot, loadoutNamed('Yasuo'));

    const stored = loadPregameConfig();
    expect(stored.player.championName).toBe('Zed');
    expect(stored.ai.bots[0].championName).toBe('Yasuo');
  });

  it('persists a removal as a lower bot count', () => {
    const { director } = bench();
    const first = director.addBot(loadoutNamed('Ahri'))!;
    director.addBot(loadoutNamed('Zed'));
    expect(loadPregameConfig().ai.count).toBe(2);

    director.removeBot(first);

    const stored = loadPregameConfig();
    expect(stored.ai.count).toBe(1);
    // The survivor slides down to slot 0 — the config is a list of bots, not a
    // map of the seats they were sitting in.
    expect(stored.ai.bots[0].championName).toBe('Zed');
    expect(stored.ai.botTeams[0]).toBe(TeamId.RED);
  });

  it('persists the actual live team for every queued bot so reload keeps the same sides', () => {
    const { director } = bench();

    const first = director.addBot(loadoutNamed('Ahri'))!;
    const second = director.addBot(loadoutNamed('Zed'))!;

    expect([first.teamId, second.teamId]).toEqual([TeamId.RED, TeamId.RED]);
    expect(loadPregameConfig().ai.botTeams.slice(0, 2)).toEqual([TeamId.RED, TeamId.RED]);
  });

  it('moves a bot to the other team live and persists the new side', () => {
    const { director } = bench();
    const bot = director.addBot(loadoutNamed('Ahri'))!;
    expect(bot.teamId).toBe(TeamId.RED);

    director.setTeam(bot, TeamId.BLUE);

    expect(bot.teamId).toBe(TeamId.BLUE);
    expect(loadPregameConfig().ai.botTeams[0]).toBe(TeamId.BLUE);
  });

  it('moves the player off Blue and persists it as playerTeam, unlike a bot', () => {
    const { director, ctx } = bench();
    expect(ctx.player.teamId).toBe(TeamId.BLUE);

    director.setTeam(ctx.player, TeamId.RED);

    expect(ctx.player.teamId).toBe(TeamId.RED);
    expect(loadPregameConfig().playerTeam).toBe(TeamId.RED);
  });

  it('does not write storage when a team switch changes nothing', () => {
    const { director, ctx } = bench();
    director.setRules({ cooldownReductionPercent: 20, manaFree: false });
    const before = storage.getItem(STORAGE_KEY);

    // The player is already Blue; asking for Blue again must be a no-op.
    director.setTeam(ctx.player, TeamId.BLUE);

    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  /**
   * The paused-panel trap, which is the whole reason this derivation cannot be
   * a one-liner over `objectManager.objects`.
   *
   * The panel holds the match paused, so `ObjectManager.update()` — the only
   * thing that flushes `_objectToBeAdd` — has not run. A bot the player just
   * added is queued, not in `objects`. Deriving the config from `objects`
   * alone writes that bot out as absent: the player adds a bot, closes the
   * panel, reloads, and the bot they added is gone. `bots()` already reads both
   * lists and skips `toRemove` for exactly this reason; the persistence hook
   * has to go through it rather than round the back.
   *
   * This test fails against the naive version — measured, not reasoned about.
   */
  it('counts a bot added while the match is paused, i.e. before any update() flush', () => {
    const { director, ctx } = bench();

    director.addBot(loadoutNamed('Ahri'));
    // Deliberately no `ctx.objectManager.update()`: this is the panel's world.
    expect(ctx.objectManager.objects.filter(o => o.constructor.name === 'AIChampion')).toHaveLength(
      0
    );
    expect(ctx.objectManager._objectToBeAdd).toHaveLength(1);

    const stored = loadPregameConfig();
    expect(stored.ai.count).toBe(1);
    expect(stored.ai.bots[0].championName).toBe('Ahri');
  });

  it('drops a bot removed while paused, whose sweep has not run either', () => {
    const { director, ctx } = bench();
    const bot = director.addBot(loadoutNamed('Ahri'))!;
    ctx.objectManager.update(); // it is in the world now

    director.removeBot(bot);

    // Still in `objects` — the sweep needs an unpaused tick — but off the
    // roster, and so out of the config.
    expect(ctx.objectManager.objects).toContain(bot);
    expect(loadPregameConfig().ai.count).toBe(0);
  });

  /**
   * **This suite used to assert the opposite**, and the reversal is deliberate
   * rather than a relaxation.
   *
   * The old rule was "match configuration persists, session state does not":
   * cheats and debug layers were things a player switched on to try something,
   * and an invulnerable champion nobody remembered asking for would read as a
   * bug report rather than a restored setting.
   *
   * What changed is that the setup screen and the practice panel became one
   * panel, mounted both over the menu and over a running match. A single panel
   * with two classes of control — one that comes back and one that silently
   * does not — is a worse thing to explain than a cheat that stays on, and the
   * old rule was invisible from the control itself. The mitigation is
   * legibility, not forgetting: the roster row marks an invulnerable
   * participant without anything being expanded.
   *
   * What is still *not* persisted is `refill` and `clearCooldowns` — those are
   * actions, not settings, and have nothing to store — and stack counts, which
   * would need keying by slot and spell id and replaying at spawn.
   */
  describe('cheats and debug flags persist', () => {
    it('writes the config when a cheat is switched on, with nothing else moving', () => {
      const { director, ctx } = bench();
      director.setRules({ cooldownReductionPercent: 20, manaFree: false });
      const before = JSON.parse(storage.getItem(STORAGE_KEY)!) as Record<string, unknown>;

      director.setInvulnerable(ctx.player, true);
      director.revealMap = true;
      director.setDebugFlag('terrain', true);

      const after = JSON.parse(storage.getItem(STORAGE_KEY)!) as Record<string, unknown>;
      expect(after.cheats).not.toEqual(before.cheats);
      // The rest of the blob is untouched: a cheat write is still a whole-config
      // derivation, so a bug there would show up as the roster or the rules
      // moving on their own.
      for (const section of ['player', 'playerTeam', 'ai', 'rules', 'world']) {
        expect(after[section]).toEqual(before[section]);
      }
    });

    it('stores exactly what was switched on, per unit', () => {
      const { director, ctx } = bench();
      director.setInvulnerable(ctx.player, true);
      director.revealMap = true;
      director.setDebugFlag('quadtree', true);

      const cheats = loadPregameConfig().cheats;
      expect(cheats.playerInvulnerable).toBe(true);
      expect(cheats.revealMap).toBe(true);
      expect(cheats.debug.quadtree).toBe(true);
      expect(cheats.debug.terrain).toBe(false);
      expect(cheats.botInvulnerable.every(on => !on)).toBe(true);
    });

    it('switches a cheat back off in storage too', () => {
      const { director, ctx } = bench();
      director.setInvulnerable(ctx.player, true);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(true);

      director.setInvulnerable(ctx.player, false);
      expect(loadPregameConfig().cheats.playerInvulnerable).toBe(false);
    });

    it('writes the six sections and no more', () => {
      const { director, ctx } = bench();
      director.setInvulnerable(ctx.player, true);
      director.setRules({ cooldownReductionPercent: 10, manaFree: false });

      const raw = storedRaw()!;
      expect(Object.keys(raw).sort()).toEqual([
        'ai',
        'cheats',
        'mapId',
        'player',
        'playerTeam',
        'rules',
        'world',
      ]);
      expect(Object.keys(raw.cheats as object).sort()).toEqual([
        'botInvulnerable',
        'debug',
        'playerInvulnerable',
        'revealMap',
      ]);
    });

    it('still stores nothing for refill, clearCooldowns or stacks', () => {
      const { director, ctx } = bench();
      director.setRules({ cooldownReductionPercent: 20, manaFree: false });
      const before = storage.getItem(STORAGE_KEY);

      director.refill(ctx.player);
      director.clearCooldowns(ctx.player);

      expect(storage.getItem(STORAGE_KEY)).toBe(before);
      // Stack counts go through `Spell.setStackCount` and the director never
      // sees them; this catches a future stack cheat being routed through here.
      expect(storage.getItem(STORAGE_KEY)!.toLowerCase()).not.toContain('stack');
    });
  });

  /**
   * Two things in the config have no live counterpart to derive them from, so
   * the write has to preserve rather than invent them.
   */
  describe('what the panel does not own, it does not overwrite', () => {
    it('keeps the setup screen’s global AI flags', () => {
      savePregameConfig({
        ...DEFAULT_PREGAME_CONFIG,
        ai: { ...DEFAULT_PREGAME_CONFIG.ai, autoMove: true, autoAttack: false, autoCast: false },
      });
      const { director } = bench();

      director.setRules({ cooldownReductionPercent: 50, manaFree: false });

      const stored = loadPregameConfig();
      expect(stored.ai.autoMove).toBe(true);
      expect(stored.ai.autoAttack).toBe(false);
      expect(stored.ai.autoCast).toBe(false);
    });

    it('keeps the bot slots past the live bot count', () => {
      const bots = Array.from({ length: AI_COUNT_MAX }, (_, i) => loadoutNamed(`Slot${i}`));
      const botTeams = Array.from({ length: AI_COUNT_MAX }, (_, i) =>
        i < 2 ? TeamId.BLUE : TeamId.RED
      );
      savePregameConfig({
        ...DEFAULT_PREGAME_CONFIG,
        ai: { ...DEFAULT_PREGAME_CONFIG.ai, bots, botTeams },
      });
      const { director } = bench();

      director.addBot(loadoutNamed('Ahri'));

      const stored = loadPregameConfig();
      expect(stored.ai.count).toBe(1);
      expect(stored.ai.bots[0].championName).toBe('Ahri');
      // Untouched, so lowering the bot count and raising it again does not lose
      // a bot's customisation — the same promise `AIConfig.bots` already made.
      expect(stored.ai.bots[1].championName).toBe('Slot1');
      expect(stored.ai.botTeams[1]).toBe(TeamId.BLUE);
      expect(stored.ai.bots).toHaveLength(AI_COUNT_MAX);
    });
  });

  it('gives a bot added mid-match the global flags as its starting behaviour', () => {
    savePregameConfig({
      ...DEFAULT_PREGAME_CONFIG,
      ai: { ...DEFAULT_PREGAME_CONFIG.ai, autoMove: true, autoCast: false },
    });
    const { director } = bench();

    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    expect(bot._autoMove).toBe(true);
    expect(bot._autoCast).toBe(false);
    expect(loadPregameConfig().ai.botBehaviours[0]).toEqual({
      autoMove: true,
      autoAttack: true,
      autoCast: false,
      // The setup screen has no difficulty control, so the global flags say
      // nothing about it: a bot added mid-match is a bot nobody has tuned.
      difficulty: 'normal',
    });
  });

  /**
   * The tier is a *live* field on the bot, so it has to be read back off the
   * unit the way its side and its flags already are — not patched into the
   * stored config at the point the panel writes it. A match retuned to hard
   * bots that reloads as normal ones is the whole bug this closes.
   */
  it('reads a retuned difficulty back off the live bot', () => {
    const { director } = bench();
    const bot = director.addBot(loadoutNamed('Ahri'))!;

    director.setBotBehaviour(bot, { difficulty: 'hard' });

    expect(bot._difficulty).toBe('hard');
    expect(loadPregameConfig().ai.botBehaviours[0].difficulty).toBe('hard');
    expect(director.toPregameConfig().ai.botBehaviours[0].difficulty).toBe('hard');
    // The slots past the live roster keep whatever storage had for them.
    expect(loadPregameConfig().ai.botBehaviours[1].difficulty).toBe('normal');
  });

  /**
   * Persisting everything takes away the clean slate every new match used to
   * be, so the panel has to hand it back explicitly. The button is on the Trận
   * đấu tab beside the exit, behind the same two-step confirm — and it has to
   * do what it says *now*, not at the next match, which is why this asserts the
   * running match as well as the storage.
   */
  describe('resetToDefaults', () => {
    it('restores the defaults in storage and in the running match', async () => {
      const { director, ctx } = bench();
      ctx.spawnJungle = vi.fn();
      const bot = director.addBot(loadoutNamed('Ahri'))!;
      director.setBotBehaviour(bot, { autoMove: true });
      director.applyLoadout(ctx.player, loadoutNamed('Zed'));
      director.setRules({ cooldownReductionPercent: 90, manaFree: true });
      director.jungleEnabled = false;
      director.minionsEnabled = false;

      expect(await director.resetToDefaults()).toBe(true);

      // storage
      expect(loadPregameConfig()).toEqual(DEFAULT_PREGAME_CONFIG);
      // and the match, which is the half a "write the defaults" implementation
      // would skip
      expect(director.getRules()).toEqual(DEFAULT_PREGAME_CONFIG.rules);
      expect(ctx.matchRules.cooldownMultiplier).toBe(1);
      expect(ctx.matchRules.manaFree).toBe(false);
      expect(director.jungleEnabled).toBe(true);
      expect(ctx.spawnJungle).toHaveBeenCalled(); // the camps come back now
      expect(director.minionsEnabled).toBe(true);
      expect(director.loadoutOf(ctx.player)).toEqual(DEFAULT_PREGAME_CONFIG.player);
      expect(bot.toRemove).toBe(true);
      expect(director.bots()).toHaveLength(DEFAULT_PREGAME_CONFIG.ai.count);
      expect(director.bots().every(b => b !== bot)).toBe(true);
      expect(director.bots().map(b => b.teamId)).toEqual(
        DEFAULT_PREGAME_CONFIG.ai.botTeams.slice(0, DEFAULT_PREGAME_CONFIG.ai.count)
      );
    });

    it('clears the setup screen’s global AI flags too — it is a reset, not a partial one', async () => {
      savePregameConfig({
        ...DEFAULT_PREGAME_CONFIG,
        ai: { ...DEFAULT_PREGAME_CONFIG.ai, autoMove: false, autoAttack: false },
      });
      const { director } = bench();

      await director.resetToDefaults();

      expect(loadPregameConfig().ai.autoMove).toBe(true);
      expect(loadPregameConfig().ai.autoAttack).toBe(true);
    });
  });

  it('survives localStorage being unavailable rather than breaking the match', () => {
    vi.unstubAllGlobals();
    const { director } = bench();
    expect(() => director.setRules({ cooldownReductionPercent: 30, manaFree: true })).not.toThrow();
    expect(director.getRules().cooldownReductionPercent).toBe(30);
  });
});
