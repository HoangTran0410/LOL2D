/**
 * What the team can see is not the same question as what is worth painting.
 *
 * `calculateSight` narrowed its revealers to those whose circle meets the camera
 * box. For the fog overlay that is right and valuable — there is no point
 * erasing fog off screen. But the same pass is the only writer of
 * `visibleToPlayerTeam`, and `Game.minimapBlips` reads that flag to decide
 * whether a unit gets a dot. The minimap draws the *whole map*.
 *
 * So allied minions, wards and champions vanished from the minimap the moment
 * the player walked away from them, along with everything they were lighting —
 * the team had the vision, and the map would not show it.
 *
 * Turrets and fountains were the exception that hid it: they are structures, so
 * `minimapBlips` draws them without consulting the flag at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar from '../../../src/game/gameObject/map/FogOfWar';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/** The camera, parked at the top-left corner and nowhere near the action. */
const CAMERA = { x: 0, y: 0, w: 800, h: 600 };
/** Far outside it, by more than any reveal radius on the roster. */
const AWAY = { x: 3_000, y: 3_000 };

let game: TestGame;

const fogOver = (world: TestGame): FogOfWar => {
  const fog = Object.create(FogOfWar.prototype) as FogOfWar;
  (fog as unknown as { game: unknown }).game = world;
  // The raycast is a different concern and needs a real terrain map. This suite
  // is about which revealers the pass considers, so the polygon half is stubbed
  // out to reveal nothing — every reveal an assertion below sees came from a
  // circle revealer.
  (fog as unknown as { calculateSightForObject: () => unknown }).calculateSightForObject = () => ({
    sightPoly: [],
    playersInSight: [],
  });
  return fog;
};

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  (game as unknown as { camera: unknown }).camera = { getBoundingBox: () => CAMERA };
});
afterEach(() => vi.unstubAllGlobals());

describe('an allied revealer off camera still lights the map', () => {
  it('marks the enemy standing in an allied minion’s circle', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const ally = new Minion({
      game,
      teamId: TeamId.BLUE,
      position: createVector(AWAY.x, AWAY.y),
      waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
      lane: Lane.MID,
    });
    expect(ally.fogRevealRadius).toBeGreaterThan(0);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x + 10, AWAY.y);

    indexObjects(game, [player, ally, enemy]);
    fogOver(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });

  it('marks the allied minion itself, so its own dot survives', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const ally = new Minion({
      game,
      teamId: TeamId.BLUE,
      position: createVector(AWAY.x, AWAY.y),
      waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
      lane: Lane.MID,
    });

    indexObjects(game, [player, ally]);
    fogOver(game).calculateSight();

    expect(ally.visibleToPlayerTeam).toBe(true);
  });

  it('still hides an enemy nobody on the team is lighting', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x, AWAY.y);

    indexObjects(game, [player, enemy]);
    fogOver(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(false);
  });
});
