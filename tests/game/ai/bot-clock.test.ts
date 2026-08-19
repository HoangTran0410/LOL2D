/**
 * Every bot reads one clock, and it is the game's.
 *
 * `TeamBlackboard` is a single object per game and every question asked of it
 * is a subtraction against the caller's clock — `refreshIfStale` compares
 * `nowMs - builtAtMs`, `rememberedTarget` compares `nowMs - entry.atMs`. Give
 * each bot an accumulator of its own and a bot built mid-match (the Đội tab's
 * "add bot", `MatchDirector.addBot`) starts at 0 while the bots already on the
 * field are five minutes in. Its subtractions then come out large and negative:
 * no memory ever expires for it, so it latches into SEARCH and its tier's
 * `memoryTtlMs` stops meaning anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { blackboardFor } from '../../../src/game/ai/TeamBlackboard';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';

/** Five minutes of match, i.e. long enough for the two clocks to disagree. */
const MATCH_MINUTE_FIVE = 300_000;
/** Past `normal`'s 2500ms memory, inside the board's own 5000ms ceiling. */
const LATER = MATCH_MINUTE_FIVE + 3_000;

describe('a bot added mid-match shares the clock the match is already on', () => {
  beforeEach(() => {
    stubGameGlobals();
    // One frame longer than the 250ms think tick, so a bot on an accumulator of
    // its own would still *think* on its first update — the difference this
    // test is about is then the memory subtraction and nothing else.
    vi.stubGlobal('deltaTime', 300);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('forgets a sighting on its tier, not on a clock of its own', () => {
    const game: TestGame = createGame();
    const veteran = new AIChampion({
      game,
      position: createVector(0, 0),
      teamId: BLUE,
      preset: PRESET,
    });
    const enemy = new Champion({
      game,
      position: createVector(200, 0),
      teamId: RED,
      preset: PRESET,
    });
    game.setPlayer(veteran);
    indexObjects(game, [veteran, enemy]);

    // Five minutes in, the team sees it: the board stamps the sighting 300000.
    blackboardFor(game, MATCH_MINUTE_FIVE, () => true);

    // The panel adds a bot now. An accumulator of its own would start at zero.
    const newcomer = new AIChampion({
      game,
      position: createVector(0, 0),
      teamId: BLUE,
      preset: PRESET,
    });
    indexObjects(game, [veteran, newcomer, enemy]);

    // The enemy has walked out of anyone's aggro range, so only the memory is
    // left to act on. The board is refreshed with nobody seeing anything, so
    // the entry keeps its old stamp rather than being written again.
    enemy.position.set(5_000, 0);
    game.matchTimeMs = LATER;
    blackboardFor(game, LATER, () => false);

    // A wrong value to start from: `posture` defaults to ROAM, so asserting it
    // without this would pass on a brain that never thought at all.
    newcomer.brain.posture = 'FIGHT';

    newcomer.update();

    // PUSH, not ROAM: a bot with a lane assignment and nobody to fight walks to
    // its lane now. What this test is about is unchanged — SEARCH outranks
    // PUSH, so a memory that had not expired would still show up here.
    expect(newcomer.brain.posture).toBe('PUSH');
  });
});
