import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, indexObjects, stubGameGlobals } from '../fixtures';

describe('Fountain', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('restores health and mana only for champions on its own team', () => {
    const game = createGame();
    const ally = new Champion({
      game,
      position: createVector(100, 100),
      teamId: TeamId.BLUE,
    });
    const enemy = new Champion({
      game,
      position: createVector(100, 100),
      teamId: TeamId.RED,
    });
    game.setPlayer(ally);
    indexObjects(game, [ally, enemy]);

    ally.stats.health.baseValue = 10;
    ally.stats.mana.baseValue = 10;
    enemy.stats.health.baseValue = 10;
    enemy.stats.mana.baseValue = 10;

    const fountain = new Fountain({
      game,
      preset: {
        name: 'Blue Fountain',
        x: 100,
        y: 100,
        r: 150,
        teamId: TeamId.BLUE,
        tickInterval: 500,
        healPercent: 0.5,
        manaPercent: 0.5,
      },
    });

    expect(fountain.championsInside()).toEqual([ally]);
    fountain.update();

    expect(ally.stats.health.baseValue).toBeGreaterThan(10);
    expect(ally.stats.mana.baseValue).toBeGreaterThan(10);
    expect(enemy.stats.health.baseValue).toBe(10);
    expect(enemy.stats.mana.baseValue).toBe(10);
  });
});
