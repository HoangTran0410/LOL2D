import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import {
  blackboardFor,
  BLACKBOARD_TTL_MS,
  MEMORY_MAX_MS,
} from '../../../src/game/ai/TeamBlackboard';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};

const BLUE = 'team-blue';
const RED = 'team-red';

const spawn = (game: TestGame, teamId: string, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId, preset: PRESET });

describe('shared last-seen memory', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('remembers an enemy any one ally can see — not only the ally that looked', () => {
    const game = createGame();
    const watcher = spawn(game, BLUE, 0, 0);
    const blindMate = spawn(game, BLUE, 900, 900);
    const red = spawn(game, RED, 300, 0);
    game.setPlayer(watcher);
    indexObjects(game, [watcher, blindMate, red]);

    const sees = (observer: Champion) => observer === watcher;
    const view = blackboardFor(game, 5_000, sees).viewFor(BLUE);

    // One map for the whole team: the far ally reads what the watcher saw.
    expect(view.memory.get(red)?.atMs).toBe(5_000);
    expect(view.memory.get(red)?.pos).toEqual({ x: 300, y: 0 });
  });

  it('records nothing for an enemy nobody can see', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 300, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    expect(
      blackboardFor(game, 0, () => false)
        .viewFor(BLUE)
        .memory.get(red)
    ).toBeUndefined();
  });

  it('keeps the last sighting after the enemy disappears', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 300, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    blackboardFor(game, 0, () => true).viewFor(BLUE);
    red.position.set(700, 0);
    const later = blackboardFor(game, BLACKBOARD_TTL_MS, () => false).viewFor(BLUE);

    // The entry is the OLD position and the OLD timestamp: that is the point.
    expect(later.memory.get(red)?.pos).toEqual({ x: 300, y: 0 });
    expect(later.memory.get(red)?.atMs).toBe(0);
  });

  it('records which way the enemy was heading, so a chase can extrapolate', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 300, 0);
    red.destination.set(300, 1_000);
    red.stats.speed.baseValue = 4;
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    // Heading due south at 4px/frame: velocity is (0, 4) by hand.
    const seen = blackboardFor(game, 0, () => true)
      .viewFor(BLUE)
      .memory.get(red);
    expect(seen?.vel.x).toBeCloseTo(0, 6);
    expect(seen?.vel.y).toBeCloseTo(4, 6);
  });

  it('forgets an entry older than the hard ceiling', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 300, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    blackboardFor(game, 0, () => true).viewFor(BLUE);
    const stale = blackboardFor(game, MEMORY_MAX_MS + 1, () => false).viewFor(BLUE);
    expect(stale.memory.get(red)).toBeUndefined();
  });

  it('forgets an enemy that died, so nobody chases a corpse', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 300, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    blackboardFor(game, 0, () => true).viewFor(BLUE);
    red.stats.health.baseValue = 0;
    red.die({ reviveAfter: 5_000 });
    const after = blackboardFor(game, BLACKBOARD_TTL_MS, () => false).viewFor(BLUE);
    expect(after.memory.get(red)).toBeUndefined();
  });

  it("keeps the two teams' memories apart", () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 300, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    const board = blackboardFor(game, 0, () => true);
    expect(board.viewFor(BLUE).memory.get(red)).toBeDefined();
    expect(board.viewFor(BLUE).memory.get(blue)).toBeUndefined();
    expect(board.viewFor(RED).memory.get(blue)).toBeDefined();
  });
});
