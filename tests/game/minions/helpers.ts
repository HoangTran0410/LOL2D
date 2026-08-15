import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import type { MinionSpawnerContext } from '../../../src/game/managers/MinionSpawner';
import { FountainPreset } from '../../../src/game/preset';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

export type SpawnerGame = TestGame & MinionSpawnerContext & { fountains: Fountain[] };

/**
 * A game with both bases' fountains standing in it, which is the whole of what
 * `MinionSpawner` reads from its context.
 *
 * Stubs the p5 globals itself: `Fountain` and `Champion` both reach for
 * `createVector` while being constructed, and `MinionSpawner.update()` reads
 * the `deltaTime` global. Undoing that is still the caller's job — every suite
 * here wants `afterEach(() => vi.unstubAllGlobals())`.
 */
export function createSpawnerContext(): SpawnerGame {
  stubGameGlobals();

  const game = createGame() as SpawnerGame;
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  game.fountains = FountainPreset.map(preset => new Fountain({ game, preset }));

  return game;
}
