import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Turret, {
  DEFAULT_TURRET_PRESET,
  TurretBolt,
} from '../../../src/game/gameObject/structures/Turret';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import TeamId from '../../../src/game/enums/TeamId';
import { turretsFromSlots } from '../../../src/game/preset';
// Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/` and
// into the pack.
import { summonersRift } from '../../../packs/riot/maps/summonersRift';
import { summonersRiftGeometry } from '../../../packs/riot/maps/summonersRiftGeometry';
import mapData from '../../../packs/riot/maps/summoner_map.json';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import turretSource from '../../../src/game/gameObject/structures/Turret.ts?raw';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

let game: TestGame;

const makeTurret = (teamId: string, x = 0, y = 0) =>
  new Turret({ game, position: createVector(x, y), teamId });

const makeMinion = (teamId: string, x: number, y = 0) =>
  new Minion({
    game,
    teamId,
    position: createVector(x, y),
    waypoints: getLaneWaypoints(Lane.MID, teamId),
    lane: Lane.MID,
  });

describe('Turret as a team building', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('target preference', () => {
    it('shoots the nearest hostile minion ahead of a closer champion', () => {
      const turret = makeTurret(TeamId.BLUE);
      const minion = makeMinion(TeamId.RED, 300);
      const champion = new Champion({ game, teamId: 'solo', position: createVector(80, 0) });
      indexObjects(game, [turret, minion, champion]);

      expect(turret.findTarget()).toBe(minion);
    });

    it('picks the nearest of several hostile minions', () => {
      const turret = makeTurret(TeamId.BLUE);
      const far = makeMinion(TeamId.RED, 380);
      const near = makeMinion(TeamId.RED, 150);
      indexObjects(game, [turret, far, near]);

      expect(turret.findTarget()).toBe(near);
    });

    it('falls back to a champion when no minion is in range', () => {
      const turret = makeTurret(TeamId.BLUE);
      const champion = new Champion({ game, teamId: 'solo', position: createVector(120, 0) });
      const distantMinion = makeMinion(TeamId.RED, DEFAULT_TURRET_PRESET.attackRange + 400);
      indexObjects(game, [turret, champion, distantMinion]);

      expect(turret.findTarget()).toBe(champion);
    });

    it('never shoots its own side', () => {
      const turret = makeTurret(TeamId.BLUE);
      const friendly = makeMinion(TeamId.BLUE, 120);
      indexObjects(game, [turret, friendly]);

      expect(turret.findTarget()).toBeNull();
    });

    it('still leaves the jungle alone', () => {
      const turret = makeTurret(TeamId.BLUE);
      const monster = new Monster({
        game,
        preset: {
          name: 'Camp',
          avatar: TEST_AVATAR_KEY,
          camp: { x: 100, y: 0, r: 100 },
          speed: 0,
          size: 60,
          attackRange: 50,
          reviveTime: 100,
          health: 300,
        },
      });
      indexObjects(game, [turret, monster]);

      expect(turret.findTarget()).toBeNull();
    });

    it('does not shoot the enemy turret next to it', () => {
      const turret = makeTurret(TeamId.BLUE);
      const enemyTurret = makeTurret(TeamId.RED, 200);
      indexObjects(game, [turret, enemyTurret]);

      expect(turret.findTarget()).toBeNull();
    });

    it('fires a homing bolt at whatever it picked, and damages only that', () => {
      const turret = makeTurret(TeamId.BLUE);
      const minion = makeMinion(TeamId.RED, 200);
      const bystander = makeMinion(TeamId.RED, 210);
      indexObjects(game, [turret, minion, bystander]);

      const damage = vi.spyOn(minion, 'takeDamage');
      const collateral = vi.spyOn(bystander, 'takeDamage');
      turret.fireAt(minion);

      const bolt = game.objectManager._objectToBeAdd.find(
        (o): o is TurretBolt => o instanceof TurretBolt
      )!;
      expect(bolt.target).toBe(minion);
      expect(bolt.maxHitCount).toBe(0);

      bolt.onArrive();
      expect(damage).toHaveBeenCalledWith(DEFAULT_TURRET_PRESET.damage, turret);
      expect(collateral).not.toHaveBeenCalled();
    });
  });

  /**
   * A turret fires on its own timer rather than through
   * `BasicAttackController`, so it never consulted the gate every champion
   * respects. It is the same hole minions and jungle camps had: crowd control
   * landed, the status flags applied, and the building kept shooting through it.
   */
  describe('crowd control', () => {
    const boltsOf = () =>
      game.objectManager._objectToBeAdd.filter(o => o instanceof TurretBolt).length;

    it('holds its fire while it is stunned', () => {
      const turret = makeTurret(TeamId.BLUE);
      const minion = makeMinion(TeamId.RED, 200);
      indexObjects(game, [turret, minion]);
      turret._attackCooldown = 0;

      turret.addBuff(new Stun(2_000, minion, turret));
      turret.update();

      expect(boltsOf()).toBe(0);
    });

    it('resumes the moment the stun ends, with nothing banked', () => {
      const turret = makeTurret(TeamId.BLUE);
      const minion = makeMinion(TeamId.RED, 200);
      indexObjects(game, [turret, minion]);
      turret._attackCooldown = 0;

      const buff = new Stun(2_000, minion, turret);
      turret.addBuff(buff);
      turret.update();
      buff.deactivateBuff();
      turret.update();

      expect(boltsOf()).toBe(1);
    });
  });

  describe('team assignment', () => {
    it('gives turret1 to blue and turret2 to red, keeping every point', () => {
      // turretsFromSlots reads the active map's own structure slots — no
      // asset load to stub, since `summonersRiftGeometry` assembles them
      // from the map JSON directly (see that module's own doc comment).
      const positions = turretsFromSlots(
        summonersRiftGeometry.slots.structure,
        summonersRift.factions
      );

      expect(positions).toHaveLength(mapData.turret1.length + mapData.turret2.length);
      const blue = positions.filter(p => p.teamId === TeamId.BLUE);
      const red = positions.filter(p => p.teamId === TeamId.RED);
      expect(blue.map(p => [p.x, p.y])).toEqual(mapData.turret1);
      expect(red.map(p => [p.x, p.y])).toEqual(mapData.turret2);
    });

    it('leaves champions hostile to both rows without a special case', () => {
      const blueTurret = makeTurret(TeamId.BLUE);
      const redTurret = makeTurret(TeamId.RED, 1_000);
      const champion = new Champion({ game, teamId: 'solo', position: createVector(100, 0) });
      const nearRed = new Champion({ game, teamId: 'other', position: createVector(1_100, 0) });
      indexObjects(game, [blueTurret, redTurret, champion, nearRed]);

      expect(blueTurret.findTarget()).toBe(champion);
      expect(redTurret.findTarget()).toBe(nearRed);
    });

    it('no longer documents itself as a neutral hazard', () => {
      expect(turretSource).toContain('A team building');
      expect(turretSource).not.toContain('A neutral hazard');
      expect(turretSource).not.toContain('The game has no team model');
    });
  });

  it('keeps its rebuild timer', () => {
    const turret = makeTurret(TeamId.BLUE, 400, 400);
    expect(turret.reviveTime).toBe(DEFAULT_TURRET_PRESET.rebuildTime);

    turret.takeDamage(DEFAULT_TURRET_PRESET.health, undefined);
    expect(turret.isDead).toBe(true);
    expect(turret.toRemove).toBe(false);
    expect(turret.deathData?.reviveAfter).toBe(DEFAULT_TURRET_PRESET.rebuildTime);

    turret.respawn();
    expect(turret.deathData).toBeNull();
    expect(turret.stats.health.value).toBe(DEFAULT_TURRET_PRESET.health);
    expect(turret.position).toMatchObject({ x: 400, y: 400 });
  });
});
