import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PregameConfigSource from '../../src/game/hud/config/PregameConfigSource';
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
 * The menu-side source, tested where it touches the **parallel arrays**:
 * `ai.bots`, `ai.botTeams`, `ai.botBehaviours` and now
 * `cheats.botInvulnerable` are index-aligned, and a removal that splices one
 * without the others leaves a bot wearing somebody else's side, behaviour or
 * cheat.
 *
 * That is the one piece of `usePregameConfig.ts` — the deleted setup screen's
 * state — worth keeping a suite of its own for. Everything else it did is now
 * asserted against *both* sources in
 * `tests/game/config/matchConfigSource.contract.test.ts`; this is here because
 * the arrays only exist on this side. The in-game source has live units, where
 * the same question does not arise.
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

beforeEach(() => {
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage, location: { search: '' } });
  vi.stubGlobal('document', { body: { classList: { toggle: () => {} } } });
});
afterEach(() => vi.unstubAllGlobals());

/** Bot slots are positional ids out here — `bot-0` is the first active bot. */
const BOT = (index: number): string => `bot-${index}`;

describe('PregameConfigSource.removeBot', () => {
  it('balances a bot added after removal without changing the surviving active teams', async () => {
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
    const source = new PregameConfigSource();

    source.removeBot(BOT(0));
    expect(loadPregameConfig().ai.botTeams.slice(0, 2)).toEqual([TeamId.BLUE, TeamId.RED]);

    await source.addBot();

    // Player + the Blue survivor already outnumber Red 2–1. The new bot must
    // therefore be Red; the two survivors keep the sides they had before add.
    expect(loadPregameConfig().ai.botTeams.slice(0, 3)).toEqual([
      TeamId.BLUE,
      TeamId.RED,
      TeamId.RED,
    ]);
  });

  it('shifts teams, behaviours and cheats up with the loadouts they belong to', () => {
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
      cheats: {
        ...loadPregameConfig().cheats,
        // Same trap one array over: only the *last* of the three is immortal.
        botInvulnerable: Array.from({ length: AI_COUNT_MAX }, (_, i) => i === 2),
      },
    });
    const source = new PregameConfigSource();

    source.removeBot(BOT(1));

    const stored = loadPregameConfig();
    expect(stored.ai.count).toBe(2);
    expect(stored.ai.bots.map(bot => bot.championName).slice(0, 2)).toEqual(['Bot0', 'Bot2']);
    expect(stored.ai.botTeams.slice(0, 2)).toEqual([TeamId.RED, TeamId.RED]);
    expect(stored.ai.botBehaviours[0].autoMove).toBe(false);
    expect(stored.ai.botBehaviours[1].autoMove).toBe(false); // Bot2's own flag, not Bot1's
    // Bot2 kept its own cheat as it moved down a slot.
    expect(stored.cheats.botInvulnerable[0]).toBe(false);
    expect(stored.cheats.botInvulnerable[1]).toBe(true);
  });

  it('refills the freed tail slot from the global flags, the same seed a new bot gets', () => {
    savePregameConfig({
      ...loadPregameConfig(),
      ai: { ...loadPregameConfig().ai, count: 2, autoMove: true, autoAttack: false },
    });
    const source = new PregameConfigSource();

    source.removeBot(BOT(0));

    const stored = loadPregameConfig();
    expect(stored.ai.botBehaviours[AI_COUNT_MAX - 1]).toEqual({
      autoMove: true,
      autoAttack: false,
      autoCast: true,
      // The globals say nothing about a tier — there is no control for one on
      // the setup screen — so a freed slot is a bot nobody has tuned.
      difficulty: 'normal',
    });
    expect(stored.ai.botTeams[AI_COUNT_MAX - 1]).toBe(
      DEFAULT_PREGAME_CONFIG.ai.botTeams[AI_COUNT_MAX - 1]
    );
    // A freed cheat slot is off, never inherited from whoever used to be there.
    expect(stored.cheats.botInvulnerable[AI_COUNT_MAX - 1]).toBe(false);
  });

  it('ignores an id past the active bot count', () => {
    const source = new PregameConfigSource();
    const before = source.botCount();
    source.removeBot(BOT(before + 3));
    expect(source.botCount()).toBe(before);
  });
});
