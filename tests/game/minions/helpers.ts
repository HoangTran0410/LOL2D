import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import type { MinionSpawnerContext } from '../../../src/game/managers/MinionSpawner';
import { fountainsFromSlots, minionMusterSlotsFrom } from '../../../src/game/preset';
// Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/` and
// into the pack.
import { summonersRift } from '../../../packs/riot/maps/summonersRift';
import { summonersRiftGeometry } from '../../../packs/riot/maps/summonersRiftGeometry';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

export type SpawnerGame = TestGame &
  MinionSpawnerContext & {
    fountains: Fountain[];
  };

/**
 * A game with both bases' fountains standing in it, and the map's own
 * declared muster points, which is the whole of what `MinionSpawner` reads
 * from its context.
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
  game.fountains = fountainsFromSlots(
    summonersRiftGeometry.slots.spawn,
    summonersRift.factions
  ).map(preset => new Fountain({ game, preset }));
  // A wave musters wherever the map declares (Task 6): straight off the map's
  // own `slots.minion`, teamId-bridged the same way `Game`'s own constructor
  // bridges it — rather than deriving it here from the live turrets, which is
  // what this replaced (`musterPointFor`, deleted, used to answer with `null`
  // for a team caught with fewer than two).
  game.minionMuster = minionMusterSlotsFrom(
    summonersRiftGeometry.slots.minion,
    summonersRift.factions
  );

  return game;
}
