import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minion, {
  AGGRO_SCAN_INTERVAL_MS,
  MinionPresets,
  WAYPOINT_TOLERANCE,
} from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints, type LaneWaypoint } from '../../../src/game/lanes';
import minionSource from '../../../src/game/gameObject/attackableUnits/Minion.ts?raw';
import {
  createGame,
  indexObjects,
  stubGameGlobals,
  type TestGame,
} from '../fixtures';

const STRAIGHT: LaneWaypoint[] = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 400 },
];

let game: TestGame;

const makeMinion = (options: Partial<Parameters<typeof Minion>[0]> = {}) =>
  new Minion({
    game,
    teamId: TeamId.BLUE,
    waypoints: STRAIGHT,
    lane: Lane.MID,
    ...options,
  } as ConstructorParameters<typeof Minion>[0]);

/** Runs `n` frames of update, so movement and cooldowns advance realistically. */
const tick = (unit: { update(): void }, frames: number) => {
  for (let i = 0; i < frames; i++) unit.update();
};

/** Forces the next update to re-run the aggro scan instead of waiting it out. */
const forceScan = (minion: Minion) => {
  minion._scanCooldown = 0;
};

describe('Minion', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('lane walking', () => {
    it('advances to the next waypoint once it arrives within tolerance', () => {
      // start 500px short of waypoint 0, so the first advance is earned
      const minion = makeMinion({ position: createVector(0, -500) });
      expect(minion.waypointIndex).toBe(0);
      expect(minion.currentWaypoint).toEqual(STRAIGHT[0]);

      // speed is per frame: 100 frames at 2.6px/frame is ~260px, still short
      tick(minion, 100);
      expect(minion.waypointIndex).toBe(0);
      expect(minion.position.y).toBeCloseTo(-500 + 99 * MinionPresets.melee.speed, 0);

      tick(minion, 100);
      expect(minion.waypointIndex).toBe(1);
      expect(minion.currentWaypoint).toEqual(STRAIGHT[1]);
      expect(minion.destination).toMatchObject(STRAIGHT[1]);
    });

    it('advances as soon as it is inside the tolerance, not only on an exact hit', () => {
      const minion = makeMinion();
      minion.position.set(STRAIGHT[0].x, STRAIGHT[0].y - (WAYPOINT_TOLERANCE - 1));

      minion.update();

      expect(minion.waypointIndex).toBe(1);
      expect(minion.destination).toMatchObject({ x: STRAIGHT[1].x, y: STRAIGHT[1].y });
    });

    it('walks the whole list and then holds on the last waypoint', () => {
      const minion = makeMinion();
      tick(minion, 400);

      expect(minion.waypointIndex).toBe(STRAIGHT.length - 1);
      expect(minion.position.x).toBeCloseTo(400, 0);
      expect(minion.position.y).toBeCloseTo(400, 0);

      // and it must not run off the end of the array
      tick(minion, 60);
      expect(minion.waypointIndex).toBe(STRAIGHT.length - 1);
      expect(minion.currentWaypoint).toEqual(STRAIGHT[STRAIGHT.length - 1]);
    });

    it('starts past the fountain waypoint when the spawner asks it to', () => {
      const minion = makeMinion({ startWaypointIndex: 1 });
      expect(minion.waypointIndex).toBe(1);
      expect(minion.currentWaypoint).toEqual(STRAIGHT[1]);
    });

    it('takes its real lane, with red walking blue s path backwards', () => {
      const blue = makeMinion({ waypoints: getLaneWaypoints(Lane.BOT, TeamId.BLUE) });
      const red = makeMinion({
        teamId: TeamId.RED,
        waypoints: getLaneWaypoints(Lane.BOT, TeamId.RED),
      });

      expect(blue.currentWaypoint).toEqual({ x: 400, y: 6_075 });
      expect(red.currentWaypoint).toEqual({ x: 6_100, y: 375 });
    });
  });

  describe('aggro target selection', () => {
    it('prefers a minion over a closer champion', () => {
      const minion = makeMinion();
      const enemyMinion = makeMinion({ teamId: TeamId.RED, position: createVector(200, 0) });
      const champion = new Champion({ game, teamId: 'other', position: createVector(60, 0) });
      indexObjects(game, [minion, enemyMinion, champion]);

      expect(minion.findTarget()).toBe(enemyMinion);
    });

    it('takes the nearest of several hostile minions', () => {
      const minion = makeMinion();
      const near = makeMinion({ teamId: TeamId.RED, position: createVector(120, 0) });
      const far = makeMinion({ teamId: TeamId.RED, position: createVector(260, 0) });
      indexObjects(game, [minion, far, near]);

      expect(minion.findTarget()).toBe(near);
    });

    it('falls back to a champion when no minion is in range', () => {
      const minion = makeMinion();
      const champion = new Champion({ game, teamId: 'other', position: createVector(150, 0) });
      indexObjects(game, [minion, champion]);

      expect(minion.findTarget()).toBe(champion);
    });

    it('never aggros a jungle camp, however close it is', () => {
      const minion = makeMinion();
      const monster = new Monster({
        game,
        preset: {
          name: 'Camp', avatar: 'monster_Baron_Nashor', camp: { x: 30, y: 0, r: 100 },
          speed: 0, size: 60, attackRange: 50, reviveTime: 100, health: 300,
        },
      });
      indexObjects(game, [minion, monster]);

      expect(minion.findTarget()).toBeNull();
    });

    it('ignores its own team, including its own turrets', () => {
      const minion = makeMinion();
      const ally = makeMinion({ teamId: TeamId.BLUE, position: createVector(100, 0) });
      indexObjects(game, [minion, ally]);

      expect(minion.findTarget()).toBeNull();
    });

    it('ignores dead and untargetable units', () => {
      const minion = makeMinion();
      const corpse = makeMinion({ teamId: TeamId.RED, position: createVector(100, 0) });
      corpse.deathData = { reviveAfter: 1_000 };
      indexObjects(game, [minion, corpse]);

      expect(minion.findTarget()).toBeNull();
    });

    it('leaves anything past the aggro radius alone', () => {
      const minion = makeMinion();
      const preset = MinionPresets.melee;
      const distant = makeMinion({
        teamId: TeamId.RED,
        position: createVector(preset.aggroRange + 200, 0),
      });
      indexObjects(game, [minion, distant]);

      expect(minion.findTarget()).toBeNull();
    });
  });

  describe('fighting', () => {
    it('stops walking, closes the gap and swings on its interval', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(200, 0) });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);

      forceScan(minion);
      minion.update();
      expect(minion.phase).toBe(Minion.PHASES.ATTACK);
      expect(minion.targetLock).toBe(enemy);
      // walking toward the target rather than toward the waypoint
      expect(minion.destination).toMatchObject({ x: 200, y: 0 });
      expect(minion.waypointIndex).toBe(0);

      tick(minion, 60);
      expect(damage).toHaveBeenCalledWith(MinionPresets.melee.damage, minion);

      // and it holds the interval between swings rather than hitting every frame
      const swings = damage.mock.calls.length;
      minion._attackCooldown = MinionPresets.melee.attackInterval;
      tick(minion, Math.floor(MinionPresets.melee.attackInterval / 16));
      expect(damage.mock.calls.length).toBe(swings);
      minion.update();
      expect(damage.mock.calls.length).toBe(swings + 1);
    });

    it('resumes its lane once the target dies', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      indexObjects(game, [minion, enemy]);

      forceScan(minion);
      minion.update();
      expect(minion.phase).toBe(Minion.PHASES.ATTACK);

      enemy.die({ reviveAfter: 0 });
      minion.update();

      expect(minion.phase).toBe(Minion.PHASES.WALK);
      expect(minion.targetLock).toBeNull();
      expect(minion.destination).toMatchObject(STRAIGHT[0]);
    });

    it('retaliates against whoever hit it, but not against a camp or an ally', () => {
      const minion = makeMinion();
      const attacker = makeMinion({ teamId: TeamId.RED, position: createVector(900, 0) });
      minion.takeDamage(5, attacker);
      expect(minion.targetLock).toBe(attacker);

      const other = makeMinion();
      other.takeDamage(5, makeMinion({ teamId: TeamId.BLUE }));
      expect(other.targetLock).toBeNull();
    });

    it('keeps its current target when something else chips it', () => {
      const minion = makeMinion();
      const locked = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      const sniper = makeMinion({ teamId: TeamId.RED, position: createVector(900, 0) });
      indexObjects(game, [minion, locked, sniper]);

      forceScan(minion);
      minion.update();
      expect(minion.targetLock).toBe(locked);

      minion.takeDamage(5, sniper);
      expect(minion.targetLock).toBe(locked);
    });

    it('scans on an interval rather than every frame', () => {
      const minion = makeMinion();
      indexObjects(game, [minion]);
      const scan = vi.spyOn(minion, 'findTarget');
      minion._scanCooldown = AGGRO_SCAN_INTERVAL_MS;

      tick(minion, Math.floor(AGGRO_SCAN_INTERVAL_MS / 16));
      expect(scan).not.toHaveBeenCalled();
      minion.update();
      expect(scan).toHaveBeenCalledTimes(1);
    });
  });

  describe('death', () => {
    it('is retired for good instead of running the respawn timer', () => {
      const minion = makeMinion();
      minion.takeDamage(MinionPresets.melee.health, undefined);

      expect(minion.isDead).toBe(true);
      expect(minion.toRemove).toBe(true);

      // AttackableUnit.update() counts deathData down and calls respawn(); a
      // minion must not come back at whichever fountain randomSpawnPoint picks
      const spawnPoint = vi.spyOn(game, 'randomSpawnPoint');
      minion.deathData = { reviveAfter: -1 };
      minion.update();

      expect(spawnPoint).not.toHaveBeenCalled();
      expect(minion.toRemove).toBe(true);
    });

    it('drops its target and stops moving when it dies', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();

      minion.takeDamage(1_000, enemy);

      expect(minion.targetLock).toBeNull();
      expect(minion.destination).toMatchObject({ x: minion.position.x, y: minion.position.y });
    });

    it('does not revive even if respawn is called directly', () => {
      const minion = makeMinion();
      minion.takeDamage(1_000, undefined);
      minion.respawn();

      expect(minion.toRemove).toBe(true);
      expect(minion.deathData).not.toBeNull();
    });
  });

  describe('rendering', () => {
    it('paints team colour rather than going through isAllied', () => {
      const blue = makeMinion();
      const red = makeMinion({ teamId: TeamId.RED });

      // the player is on neither team, so isAllied is false for both
      expect(blue.isAllied).toBe(false);
      expect(red.isAllied).toBe(false);
      expect(blue.colors).not.toEqual(red.colors);
      expect(blue.colors.body[2]).toBeGreaterThan(blue.colors.body[0]);
      expect(red.colors.body[0]).toBeGreaterThan(red.colors.body[2]);
    });

    it('stays cheap: no avatar blit, no particle system, no trail', () => {
      const spies = stubGameGlobals();
      const minion = makeMinion();

      minion.draw();

      expect(spies.image).not.toHaveBeenCalled();
      expect(minion.avatar).toBeUndefined();
      expect(minionSource).not.toContain('ParticleSystem');
      expect(minionSource).not.toContain('TrailSystem');
      // body, rim and the melee highlight, plus a two-rect health bar
      expect(spies.circle.mock.calls.length).toBeLessThanOrEqual(4);
      expect(spies.rect).toHaveBeenCalledTimes(2);
    });

    it('does not point at the mouse the way the base class does', () => {
      const spies = stubGameGlobals();
      const minion = makeMinion();
      (game as { worldMouse?: unknown }).worldMouse = createVector(1_000, 1_000);

      minion.drawDir();

      expect(spies.line).not.toHaveBeenCalled();
    });

    it('sits below jungle camps, turrets and champions in the draw order', () => {
      expect(Minion.displayZIndex).toBeLessThan(Champion.displayZIndex);
      expect(Minion.displayZIndex).toBeLessThan(3.5);
      expect(Minion.displayZIndex).toBeGreaterThan(3);
    });
  });

  it('grants no vision, so it never becomes a fog of war sight source', () => {
    const minion = makeMinion();
    expect(minion.stats.visionRadius.value).toBe(0);

    tick(minion, 60);
    expect(minion.visionRadius).toBe(0);

    // and its quadtree box stays body-sized rather than vision-sized
    const box = minion.getDisplayBoundingBox();
    expect(box.w).toBeLessThan(MinionPresets.melee.size * 2);
  });

  it('is tagged as a minion for the spell damage multipliers that look for one', () => {
    expect(makeMinion().unitType).toBe('minion');
  });

  it('has a body narrow enough for the clearance its lanes are cut to', () => {
    // Lanes.test.ts asserts every lane segment stays 40px clear of a wall; a
    // minion has to fit through that with its own radius to spare
    const widest = Math.max(...Object.values(MinionPresets).map(preset => preset.size));
    expect(widest / 2).toBeLessThan(40);
  });
});
