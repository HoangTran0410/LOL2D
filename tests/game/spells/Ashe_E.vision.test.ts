/**
 * Ashe's hawk (Ưng Tiễn) is a scout: its whole job is to open vision for the
 * team along its flight. It carries `visionRadius = 400` for exactly that.
 *
 * But `FogOfWar.calculateSight` selects its allied revealers by
 * `fogRevealRadius > 0`, a getter that lives on `AttackableUnit` alone. The hawk
 * is a `MissileSpellObject`, so `fogRevealRadius` is `undefined`, `undefined > 0`
 * is `false`, and the bird was silently dropped from the revealer list — it flew
 * across the map lighting nothing for the team.
 *
 * This isolates that selection: `calculateSightForObject` (the raycast) is
 * stubbed to reveal a known enemy *only when the hawk is the observer*, so the
 * only way the enemy gets lit is if the hawk survived the revealer filter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar from '../../../src/game/gameObject/map/FogOfWar';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { Ashe_E_Object } from '../../../src/game/gameObject/spells/Ashe_E';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const CAMERA = { x: 0, y: 0, w: 800, h: 600 };
const AWAY = { x: 3_000, y: 3_000 };

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  (game as unknown as { camera: unknown }).camera = { getBoundingBox: () => CAMERA };
});
afterEach(() => vi.unstubAllGlobals());

describe('Ashe E gives the team vision', () => {
  it('lights an enemy standing in the hawk’s sight', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const hawk = new Ashe_E_Object(player);
    hawk.position.set(AWAY.x, AWAY.y);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x + 10, AWAY.y);

    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    (fog as unknown as { game: unknown }).game = game;
    // The raycast is a separate concern (and needs real terrain). Reveal the
    // enemy only when the hawk is the one looking, so a passing test can mean
    // one thing only: the hawk survived the revealer filter.
    (
      fog as unknown as { calculateSightForObject: (obj: unknown) => unknown }
    ).calculateSightForObject = (obj: unknown) => ({
      sightPoly: [],
      playersInSight: obj === hawk ? [enemy] : [],
    });

    indexObjects(game, [player, hawk, enemy]);
    fog.calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });

  it('exposes a positive fogRevealRadius, the seam the fog selects on', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    const hawk = new Ashe_E_Object(player);
    expect(hawk.fogRevealRadius).toBeGreaterThan(0);
  });
});
