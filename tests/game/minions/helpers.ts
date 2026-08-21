import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import type { MinionSpawnerContext } from '../../../src/game/managers/MinionSpawner';
import { fountainsFromSlots, turretsFromSlots } from '../../../src/game/preset';
import { summonersRiftGeometry } from '../../../src/content/maps/summonersRiftGeometry';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

export type SpawnerGame = TestGame &
  MinionSpawnerContext & {
    fountains: Fountain[];
    turrets: { teamId: string; position: { x: number; y: number } }[];
  };

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
  game.fountains = fountainsFromSlots(summonersRiftGeometry.slots.spawn).map(
    preset => new Fountain({ game, preset })
  );
  // The wave musters between the two turrets nearest its own base now, so the
  // buildings are part of what the spawner reads. Positions only — `Turret` is
  // not constructed, because nothing here drives one.
  //
  // Straight from the map's own geometry, via `turretsFromSlots` — the same
  // translation `Game.spawnTurrets` uses — rather than `getTurretPositions()`
  // (deleted, Task 5): that read the JSON through `AssetManager`, which has
  // loaded nothing in a unit test, so it answered with an empty list — and an
  // empty turret list is exactly the fallback-to-the-fountain path, i.e. the
  // suite would have gone on testing the behaviour this replaced while
  // reading as though it covered the new one.
  game.turrets = turretsFromSlots(summonersRiftGeometry.slots.structure).map(
    ({ x, y, teamId }) => ({ teamId, position: { x, y } })
  );

  return game;
}
