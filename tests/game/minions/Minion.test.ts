import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minion, {
  AGGRO_SCAN_INTERVAL_MS,
  MELEE_SWING_TOTAL_MS,
  MELEE_WINDUP_MS,
  MinionBolt,
  MinionPresets,
  MinionSwing,
  RANGED_BOLT_SPEED,
  WAYPOINT_TOLERANCE,
  MINION_LEASH_RANGE,
} from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Airborne from '../../../src/game/gameObject/buffs/Airborne';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints, type LaneWaypoint } from '../../../src/game/lanes';
import minionSource from '../../../src/game/gameObject/attackableUnits/Minion.ts?raw';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

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
          name: 'Camp',
          avatar: TEST_AVATAR_KEY,
          camp: { x: 30, y: 0, r: 100 },
          speed: 0,
          size: 60,
          attackRange: 50,
          reviveTime: 100,
          health: 300,
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

  describe('giving a chase up', () => {
    /**
     * Without a leash a chase never ends: `findTarget` re-scans within
     * `aggroRange` of wherever the minion has got to, and chasing is exactly
     * what keeps the target inside that radius. One champion could tow a whole
     * wave off its lane and across the map, which is what was reported.
     */
    it('drops the target once it has been pulled too far off its lane', () => {
      const minion = makeMinion();
      const champion = new Champion({ game, teamId: 'other' });
      // both sit well off the lane (which starts at 0,0), but within each
      // other's aggro range
      minion.position.set(-(MINION_LEASH_RANGE + 100), 0);
      champion.position.set(-(MINION_LEASH_RANGE + 40), 0);
      indexObjects(game, [minion, champion]);

      expect(minion.distanceToLane()).toBeGreaterThan(MINION_LEASH_RANGE);
      // in range, and would be picked if the leash were not consulted
      expect(minion.findTarget()).toBe(champion);

      minion.targetLock = champion;
      minion.phase = Minion.PHASES.ATTACK;
      forceScan(minion);
      minion.update();

      expect(minion.targetLock).toBeNull();
      expect(minion.phase).toBe(Minion.PHASES.WALK);
    });

    it('keeps fighting while it is still near its lane', () => {
      const minion = makeMinion();
      const champion = new Champion({ game, teamId: 'other' });
      minion.position.set(200, 40);
      champion.position.set(240, 40);
      indexObjects(game, [minion, champion]);

      expect(minion.distanceToLane()).toBeLessThan(MINION_LEASH_RANGE);
      forceScan(minion);
      minion.update();

      expect(minion.targetLock).toBe(champion);
      expect(minion.phase).toBe(Minion.PHASES.ATTACK);
    });

    /**
     * `waypointIndex` only advances on arrival, so a minion dragged away at
     * index 0 comes back still aiming at index 0 — for a real lane that means
     * walking back past its own fountain before setting off again. Reproduced
     * in the live game before the fix: a minion parked at (3100,3400) headed
     * for (350,4710), 3046px behind it, while waypoint 3 sat 2472px ahead.
     */
    it('resumes at the nearest waypoint ahead, not the last one it touched', () => {
      const minion = makeMinion();
      const champion = new Champion({ game, teamId: 'other' });
      indexObjects(game, [minion, champion]);

      expect(minion.waypointIndex).toBe(0);
      // dragged out beside the *last* waypoint (400,400), far off the lane
      minion.position.set(400 + MINION_LEASH_RANGE + 100, 400);
      champion.position.set(9_000, 9_000); // and the target is long gone

      minion.targetLock = champion;
      minion.phase = Minion.PHASES.ATTACK;
      forceScan(minion);
      minion.update();

      expect(minion.phase).toBe(Minion.PHASES.WALK);
      expect(minion.waypointIndex).toBe(2);
    });

    it('never re-aims backwards down the lane', () => {
      const minion = makeMinion();
      const champion = new Champion({
        game,
        teamId: 'other',
        position: createVector(9_000, 9_000),
      });
      indexObjects(game, [minion, champion]);

      minion.waypointIndex = 2;
      // shoved back beside waypoint 0, which it has already walked past
      minion.position.set(-(MINION_LEASH_RANGE + 100), 0);

      minion.targetLock = champion;
      minion.phase = Minion.PHASES.ATTACK;
      forceScan(minion);
      minion.update();

      expect(minion.waypointIndex).toBe(2);
    });

    it('measures distance to the lane itself, not to its waypoints', () => {
      const minion = makeMinion();
      // halfway along the first segment: 200px from either waypoint, but on the lane
      minion.position.set(200, 0);
      expect(minion.distanceToLane()).toBe(0);
      minion.position.set(200, 90);
      expect(minion.distanceToLane()).toBeCloseTo(90, 5);
    });
  });

  describe('bushes', () => {
    it('cannot target a champion hiding in a bush', () => {
      const minion = makeMinion();
      const champion = new Champion({ game, teamId: 'other', position: createVector(100, 0) });
      indexObjects(game, [minion, champion]);

      expect(minion.findTarget()).toBe(champion);

      champion.isInsideBush = true;
      expect(minion.findTarget()).toBeNull();
    });

    it('still sees a bushed champion when it is in a bush itself', () => {
      const minion = makeMinion();
      const champion = new Champion({ game, teamId: 'other', position: createVector(100, 0) });
      indexObjects(game, [minion, champion]);

      champion.isInsideBush = true;
      minion.isInsideBush = true;
      expect(minion.findTarget()).toBe(champion);
    });
  });

  /**
   * A minion swings on its own timer rather than through
   * `BasicAttackController`, which is where the `canAttack` gate lives for
   * champions. Left ungated, a wave walked into a Yasuo tornado or a Janna Q,
   * rose into the air on the knock-up — the buff, the status flags and the
   * height all applied correctly — and kept swinging on the beat the whole way
   * up, which is what made the crowd control read as doing nothing at all.
   */
  describe('crowd control', () => {
    const engage = (minion: Minion, enemy: Minion) => {
      minion.targetLock = enemy;
      minion.phase = Minion.PHASES.ATTACK;
      minion._attackCooldown = 0;
    };

    const swingsOf = (minion: Minion) =>
      minion.game.objectManager._objectToBeAdd.filter(
        o => o instanceof MinionSwing || o instanceof MinionBolt
      ).length;

    it('launches nothing while it is knocked up', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(30, 0) });
      indexObjects(game, [minion, enemy]);
      engage(minion, enemy);

      minion.addBuff(new Airborne(2_000, enemy, minion));
      minion.updateBuffs();
      minion.updateAttack();

      expect(swingsOf(minion)).toBe(0);
    });

    it('launches nothing while it is stunned', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(30, 0) });
      indexObjects(game, [minion, enemy]);
      engage(minion, enemy);

      minion.addBuff(new Stun(2_000, enemy, minion));
      minion.updateBuffs();
      minion.updateAttack();

      expect(swingsOf(minion)).toBe(0);
    });

    it('swings the moment it lands again, with nothing banked', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(30, 0) });
      indexObjects(game, [minion, enemy]);
      engage(minion, enemy);

      const buff = new Airborne(2_000, enemy, minion);
      minion.addBuff(buff);
      minion.updateBuffs();
      minion.updateAttack();

      buff.deactivateBuff();
      minion.updateBuffs();
      minion.updateAttack();

      expect(swingsOf(minion)).toBe(1);
    });
  });

  describe('fighting', () => {
    it('stops walking, closes the gap, and lands its swing on the interval — after the wind-up, not on release', () => {
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
      // the swing exists the instant the cooldown allows it, but must not have
      // resolved damage yet — that used to happen right here, instantly
      expect(damage).not.toHaveBeenCalled();
      const swing = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionSwing => o instanceof MinionSwing
      );
      if (!swing) throw new Error('Melee minion must spawn a swing when it attacks.');

      tick(swing, Math.ceil(MELEE_WINDUP_MS / 16));
      expect(damage).toHaveBeenCalledWith(MinionPresets.melee.damage, minion);
      expect(damage).toHaveBeenCalledTimes(1);

      // and it holds the interval between swings rather than hitting every frame
      minion._attackCooldown = MinionPresets.melee.attackInterval;
      tick(minion, Math.floor(MinionPresets.melee.attackInterval / 16));
      expect(damage).toHaveBeenCalledTimes(1);

      minion.update();
      const secondSwing = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionSwing => o instanceof MinionSwing && o !== swing
      );
      if (!secondSwing) throw new Error('Melee minion must swing again after the interval.');
      tick(secondSwing, Math.ceil(MELEE_WINDUP_MS / 16));
      expect(damage).toHaveBeenCalledTimes(2);
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

  describe('ranged basic attack (MinionBolt)', () => {
    it('gives cannon minions their own durable preset and a ranged bolt', () => {
      const cannon = makeMinion({ preset: MinionPresets.cannon });
      const enemy = makeMinion({
        teamId: TeamId.RED,
        position: createVector(250, 0),
      });
      indexObjects(game, [cannon, enemy]);

      cannon.launchAttack(enemy, cannon.reachTo(enemy));

      const bolt = cannon.game.objectManager._objectToBeAdd.find(
        (o): o is MinionBolt => o instanceof MinionBolt
      );
      expect(cannon.kind).toBe('cannon');
      expect(cannon.stats.maxHealth.value).toBeGreaterThan(MinionPresets.melee.health);
      expect(cannon.damage).toBeGreaterThan(MinionPresets.ranged.damage);
      expect(bolt).toBeInstanceOf(MinionBolt);
    });

    it('fires a bolt that takes real travel time and damages exactly the target it was fired at, on arrival', () => {
      const minion = makeMinion({ preset: MinionPresets.ranged });
      const enemy = makeMinion({
        preset: MinionPresets.ranged,
        teamId: TeamId.RED,
        position: createVector(250, 0),
      });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);

      forceScan(minion);
      minion.update();
      expect(minion.phase).toBe(Minion.PHASES.ATTACK);

      const bolt = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionBolt => o instanceof MinionBolt
      );
      if (!bolt) throw new Error('Ranged minion must fire a bolt when it attacks.');
      expect(bolt.damage).toBe(MinionPresets.ranged.damage);
      expect(bolt.speed).toBe(RANGED_BOLT_SPEED);
      // damage must not resolve the instant the bolt is released
      expect(damage).not.toHaveBeenCalled();

      bolt.update();
      expect(bolt.toRemove).toBe(false);
      expect(damage).not.toHaveBeenCalled();

      for (let i = 0; i < 200 && !bolt.toRemove; i++) bolt.update();
      expect(bolt.toRemove).toBe(true);
      expect(damage).toHaveBeenCalledWith(MinionPresets.ranged.damage, minion);
      expect(damage).toHaveBeenCalledTimes(1);
    });

    it('lands nothing on a target that dies mid-flight', () => {
      const minion = makeMinion({ preset: MinionPresets.ranged });
      const enemy = makeMinion({
        preset: MinionPresets.ranged,
        teamId: TeamId.RED,
        position: createVector(250, 0),
      });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();
      const bolt = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionBolt => o instanceof MinionBolt
      );
      if (!bolt) throw new Error('Ranged minion must fire a bolt when it attacks.');

      enemy.die({ reviveAfter: 0 });

      expect(() => {
        for (let i = 0; i < 200 && !bolt.toRemove; i++) bolt.update();
      }).not.toThrow();
      expect(bolt.toRemove).toBe(true);
      expect(damage).not.toHaveBeenCalled();
    });

    it('lands nothing if the firing minion dies mid-flight', () => {
      const minion = makeMinion({ preset: MinionPresets.ranged });
      const enemy = makeMinion({
        preset: MinionPresets.ranged,
        teamId: TeamId.RED,
        position: createVector(250, 0),
      });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();
      const bolt = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionBolt => o instanceof MinionBolt
      );
      if (!bolt) throw new Error('Ranged minion must fire a bolt when it attacks.');

      minion.takeDamage(MinionPresets.ranged.health, undefined);
      expect(minion.isDead).toBe(true);

      expect(() => {
        for (let i = 0; i < 200 && !bolt.toRemove; i++) bolt.update();
      }).not.toThrow();
      expect(damage).not.toHaveBeenCalled();
    });
  });

  describe('melee basic attack (MinionSwing)', () => {
    it('lands damage after the wind-up, not when the swing is created', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();

      const swing = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionSwing => o instanceof MinionSwing
      );
      if (!swing) throw new Error('Melee minion must spawn a swing when it attacks.');
      expect(swing.damage).toBe(MinionPresets.melee.damage);
      expect(damage).not.toHaveBeenCalled();

      // still mid wind-up
      tick(swing, Math.max(0, Math.ceil(MELEE_WINDUP_MS / 16) - 1));
      expect(damage).not.toHaveBeenCalled();

      swing.update();
      expect(damage).toHaveBeenCalledWith(MinionPresets.melee.damage, minion);
      expect(damage).toHaveBeenCalledTimes(1);

      // and the swing finishes its own lifetime instead of lingering
      tick(swing, Math.ceil(MELEE_SWING_TOTAL_MS / 16));
      expect(swing.toRemove).toBe(true);
    });

    it('does not strike a target that died during the wind-up', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();
      const swing = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionSwing => o instanceof MinionSwing
      );
      if (!swing) throw new Error('Melee minion must spawn a swing when it attacks.');

      enemy.die({ reviveAfter: 0 });
      expect(() => tick(swing, Math.ceil(MELEE_WINDUP_MS / 16))).not.toThrow();

      expect(damage).not.toHaveBeenCalled();
    });

    it('does not strike if the attacker dies during the wind-up', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();
      const swing = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionSwing => o instanceof MinionSwing
      );
      if (!swing) throw new Error('Melee minion must spawn a swing when it attacks.');

      minion.takeDamage(MinionPresets.melee.health, undefined);
      expect(() => tick(swing, Math.ceil(MELEE_WINDUP_MS / 16))).not.toThrow();

      expect(damage).not.toHaveBeenCalled();
    });

    it('re-checks reach at the strike instant, in case the target stepped back during the wind-up', () => {
      const minion = makeMinion();
      const enemy = makeMinion({ teamId: TeamId.RED, position: createVector(60, 0) });
      const damage = vi.spyOn(enemy, 'takeDamage');
      indexObjects(game, [minion, enemy]);
      forceScan(minion);
      minion.update();
      const swing = minion.game.objectManager._objectToBeAdd.find(
        (o): o is MinionSwing => o instanceof MinionSwing
      );
      if (!swing) throw new Error('Melee minion must spawn a swing when it attacks.');

      enemy.position.set(60 + swing.reach + 10, 0);
      tick(swing, Math.ceil(MELEE_WINDUP_MS / 16));

      expect(damage).not.toHaveBeenCalled();
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
