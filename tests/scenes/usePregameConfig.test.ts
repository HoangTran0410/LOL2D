import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePregameConfig } from '../../src/scenes/setup/usePregameConfig';
import {
  AI_COUNT_MAX,
  DEFAULT_BOT_BEHAVIOUR,
  DEFAULT_CHAMPION_LOADOUT,
  DEFAULT_PREGAME_CONFIG,
  loadPregameConfig,
  savePregameConfig,
  type BotBehaviour,
} from '../../src/game/config/PregameConfig';
import TeamId from '../../src/game/enums/TeamId';

/**
 * The setup screen's own state, tested where it touches the *parallel* arrays
 * the practice panel's persistence added: `ai.bots` and `ai.botBehaviours` are
 * index-aligned, and a screen that splices one has to splice the other or a
 * bot's kit ends up wearing another bot's behaviour.
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

const behaviour = (autoMove: boolean): BotBehaviour => ({ ...DEFAULT_BOT_BEHAVIOUR, autoMove });

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('usePregameConfig.removeBotAt', () => {
  it('balances a bot added after removal without changing the surviving active teams', () => {
    savePregameConfig({
      ...loadPregameConfig(),
      ai: {
        ...loadPregameConfig().ai,
        count: 3,
        botTeams: [
          TeamId.RED,
          TeamId.BLUE,
          TeamId.RED,
          TeamId.BLUE,
          ...DEFAULT_PREGAME_CONFIG.ai.botTeams.slice(4),
        ],
      },
    });
    const pregame = usePregameConfig();

    pregame.removeBotAt(0);
    expect(pregame.config.value.ai.botTeams.slice(0, 2)).toEqual([TeamId.BLUE, TeamId.RED]);

    pregame.setAiCount(3);

    // Player + the Blue survivor already outnumber Red 2–1. The new bot must
    // therefore be Red; the two survivors keep the sides they had before add.
    expect(loadPregameConfig().ai.botTeams.slice(0, 3)).toEqual([
      TeamId.BLUE,
      TeamId.RED,
      TeamId.RED,
    ]);
  });

  it('shifts teams and behaviours up with the loadouts they belong to', () => {
    savePregameConfig({
      ...loadPregameConfig(),
      ai: {
        ...loadPregameConfig().ai,
        count: 3,
        bots: Array.from({ length: AI_COUNT_MAX }, (_, i) => ({
          ...DEFAULT_CHAMPION_LOADOUT,
          championName: `Bot${i}`,
        })),
        botTeams: Array.from({ length: AI_COUNT_MAX }, (_, i) =>
          i === 1 ? TeamId.BLUE : TeamId.RED
        ),
        // Only the middle bot wanders, so a shift that moved the kits without
        // the flags would leave `Bot2` wearing `Bot1`'s.
        botBehaviours: Array.from({ length: AI_COUNT_MAX }, (_, i) => behaviour(i === 1)),
      },
    });
    const pregame = usePregameConfig();

    pregame.removeBotAt(1);

    const stored = loadPregameConfig();
    expect(stored.ai.count).toBe(2);
    expect(stored.ai.bots.map(bot => bot.championName).slice(0, 2)).toEqual(['Bot0', 'Bot2']);
    expect(stored.ai.botTeams.slice(0, 2)).toEqual([TeamId.RED, TeamId.RED]);
    expect(stored.ai.botBehaviours[0].autoMove).toBe(false);
    expect(stored.ai.botBehaviours[1].autoMove).toBe(false); // Bot2's own flag, not Bot1's
  });

  it('refills the freed tail slot from the global flags, the same seed a new bot gets', () => {
    savePregameConfig({
      ...loadPregameConfig(),
      ai: { ...loadPregameConfig().ai, count: 2, autoMove: true, autoAttack: false },
    });
    const pregame = usePregameConfig();

    pregame.removeBotAt(0);

    const tail = loadPregameConfig().ai.botBehaviours[AI_COUNT_MAX - 1];
    expect(tail).toEqual({ autoMove: true, autoAttack: false, autoCast: true });
    expect(loadPregameConfig().ai.botTeams[AI_COUNT_MAX - 1]).toBe(
      DEFAULT_PREGAME_CONFIG.ai.botTeams[AI_COUNT_MAX - 1]
    );
  });
});
