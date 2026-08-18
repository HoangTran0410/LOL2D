import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Game from '../../../src/game/Game';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

describe('team fountain spawning', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('random', () => 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('selects the fountain belonging to the requested team', () => {
    const bluePoint = createVector(100, 100);
    const redPoint = createVector(900, 900);
    const blue = {
      teamId: TeamId.BLUE,
      randomPointInside: vi.fn(() => bluePoint),
    };
    const red = {
      teamId: TeamId.RED,
      randomPointInside: vi.fn(() => redPoint),
    };
    const game = { fountains: [blue, red], mapSize: 1_000 };

    const point = Game.prototype.randomSpawnPoint.call(game as unknown as Game, TeamId.RED);

    expect(point).toBe(redPoint);
    expect(red.randomPointInside).toHaveBeenCalledOnce();
    expect(blue.randomPointInside).not.toHaveBeenCalled();
  });

  it('respawns an attackable unit at its own team fountain', () => {
    const game = createGame();
    const spawn = vi.fn((teamId?: string) =>
      teamId === TeamId.RED ? createVector(900, 850) : createVector(100, 150)
    );
    game.randomSpawnPoint = spawn;
    const unit = createUnit(game, 400, TeamId.RED);

    unit.respawn();

    expect(spawn).toHaveBeenCalledWith(TeamId.RED);
    expect({ x: unit.position.x, y: unit.position.y }).toEqual({ x: 900, y: 850 });
    expect({ x: unit.destination.x, y: unit.destination.y }).toEqual({ x: 900, y: 850 });
  });
});
