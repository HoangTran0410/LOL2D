import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import ActionState from '../../../src/game/enums/ActionState';
import EventType from '../../../src/game/enums/EventType';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import EventManager from '../../../src/managers/EventManager';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Champion, {
  DEFAULT_CHAMPION_ATTACK,
  type ChampionAttackTuning,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion, {
  AI_ATTACK_SCAN_INTERVAL_MS,
} from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Charm from '../../../src/game/gameObject/buffs/Charm';
import Disarm from '../../../src/game/gameObject/buffs/Disarm';
import Fear from '../../../src/game/gameObject/buffs/Fear';
import Root from '../../../src/game/gameObject/buffs/Root';
import Silence from '../../../src/game/gameObject/buffs/Silence';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import Stats, { MAX_ATTACK_SPEED } from '../../../src/game/gameObject/Stats';
import {
  BasicAttackBolt,
  BasicAttackSwing,
  MELEE_SWING_TOTAL_MS,
  MELEE_WINDUP_MS,
  RANGED_BOLT_SPEED,
  type BasicAttackHit,
} from '../../../src/game/combat/BasicAttack';
import type { GameObjectRuntimeContext } from '../../../src/game/gameObject/GameObject';
import type GameObject from '../../../src/game/gameObject/GameObject';

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy() {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  add(vector: TestVector) {
    this.x += vector.x;
    this.y += vector.y;
    return this;
  }
  sub(vector: TestVector) {
    this.x -= vector.x;
    this.y -= vector.y;
    return this;
  }
  mult(value: number) {
    this.x *= value;
    this.y *= value;
    return this;
  }
  mag() {
    return Math.hypot(this.x, this.y);
  }
  magSq() {
    return this.x * this.x + this.y * this.y;
  }
  normalize() {
    return this.setMag(1);
  }
  setMag(value: number) {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > 0) this.mult(value / magnitude);
    return this;
  }
  dist(vector: TestVector) {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
  static add(a: TestVector, b: TestVector) {
    return a.copy().add(b);
  }
  static sub(a: TestVector, b: TestVector) {
    return new TestVector(a.x - b.x, a.y - b.y);
  }
  static dist(a: TestVector, b: TestVector) {
    return a.dist(b);
  }
}

interface TestGame extends GameObjectRuntimeContext {
  setPlayer(player: AttackableUnit): void;
}

function createGame(): TestGame {
  const camera = { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) };
  const objectManager = new ObjectManager({ mapSize: 4_000, camera });
  let player: AttackableUnit | undefined;

  return {
    mapSize: 4_000,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) throw new Error('Player is not available in this test context.');
      return player;
    },
    setPlayer(value: AttackableUnit) {
      player = value;
    },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
  };
}

let teamCounter = 0;
function champion(game: TestGame, x: number, attack?: ChampionAttackTuning): Champion {
  teamCounter += 1;
  return new Champion({
    game,
    position: createVector(x, 0),
    teamId: `team-${teamCounter}`,
    preset: attack ? { attack } : undefined,
  });
}

function indexObjects(game: TestGame, objects: GameObject[]): void {
  game.objectManager.objects = objects;
  game.objectManager._objectsTree.clear();
  for (const object of objects) {
    game.objectManager._objectsTree.insert(object.getDisplayBoundingBox());
  }
}

/** Objects the controller handed to the manager this frame, newest last. */
function pending(game: TestGame): GameObject[] {
  return game.objectManager._objectToBeAdd;
}

const MELEE: ChampionAttackTuning = { damage: 20, attacksPerSecond: 1, range: 100 };

describe('basic attacks', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', (min = 1, max?: number) =>
      max === undefined ? min * 0.5 : min + (max - min) * 0.5
    );
    vi.stubGlobal(
      'lerp',
      (from: number, to: number, amount: number) => from + (to - from) * amount
    );
    vi.stubGlobal('constrain', (n: number, low: number, high: number) =>
      Math.min(high, Math.max(low, n))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ------------------------------------------------------------------ stats

  it('caps attack speed at the stat ceiling however many buffs stack on it', () => {
    const stats = new Stats();
    stats.attackSpeed.baseValue = DEFAULT_CHAMPION_ATTACK.attacksPerSecond;
    // read off the constant, not copied from it: retuning the default rate is a
    // balance call and must never mean editing this file
    expect(stats.attackSpeed.value).toBeCloseTo(DEFAULT_CHAMPION_ATTACK.attacksPerSecond);

    stats.attackSpeed.percentBonus = 10;
    expect(stats.attackSpeed.value).toBe(MAX_ATTACK_SPEED);
    // and a stat with no ceiling is untouched by the change
    expect(stats.attackDamage.maxValue).toBe(Infinity);
  });

  it('gives a champion its attack profile and reads melee or ranged off the range alone', () => {
    const game = createGame();
    const ranged = champion(game, 0);
    const melee = champion(game, 0, MELEE);

    expect(ranged.stats.attackDamage.value).toBe(DEFAULT_CHAMPION_ATTACK.damage);
    expect(ranged.stats.attackRange.value).toBe(DEFAULT_CHAMPION_ATTACK.range);
    expect(ranged.basicAttack.isRanged).toBe(true);
    // the swing interval is the reciprocal of the rate, which is the thing
    // actually under test here — not the particular number it comes out at
    expect(ranged.basicAttack.intervalMs).toBeCloseTo(
      1_000 / DEFAULT_CHAMPION_ATTACK.attacksPerSecond
    );
    expect(melee.basicAttack.isRanged).toBe(false);
  });

  // --------------------------------------------------------------- the gate

  it('stops a disarmed unit attacking while leaving it able to move and cast', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 100);
    attacker.orderAttack(target);

    attacker.addBuff(new Disarm(1_000, attacker, attacker));
    attacker.updateBuffs();

    expect(attacker.canAttack).toBe(false);
    expect(attacker.canMove).toBe(true);
    expect(attacker.canCast).toBe(true);

    attacker.basicAttack.update();
    expect(pending(game)).toHaveLength(0);
    // crowd control ends the order rather than pausing it, so coming out of a
    // disarm leaves the unit standing still instead of back on the chase
    expect(attacker.basicAttack.target).toBeNull();
    expect(attacker.basicAttack.lastEnd).toBe('DISABLED');

    attacker.buffs[0].deactivateBuff();
    attacker.updateBuffs();
    attacker.basicAttack.update();

    expect(attacker.canAttack).toBe(true);
    expect(pending(game)).toHaveLength(0);

    // and it swings again the moment it is ordered to
    attacker.orderAttack(target);
    attacker.basicAttack.update();
    expect(pending(game)).toHaveLength(1);
  });

  it('drops a standing order on every crowd control that takes a unit over', () => {
    for (const Control of [Stun, Charm, Fear, Disarm]) {
      const game = createGame();
      const attacker = champion(game, 0);
      const target = champion(game, 100);
      attacker.orderAttack(target);

      attacker.addBuff(new Control(1_000, attacker, attacker));
      attacker.updateBuffs();
      attacker.basicAttack.update();

      expect(attacker.basicAttack.target, Control.name).toBeNull();
      expect(attacker.basicAttack.lastEnd, Control.name).toBe('DISABLED');
    }
  });

  it('keeps a standing order through a root or a silence, which stop other things', () => {
    for (const Control of [Root, Silence]) {
      const game = createGame();
      const attacker = champion(game, 0);
      const target = champion(game, 100);
      attacker.orderAttack(target);

      attacker.addBuff(new Control(1_000, attacker, attacker));
      attacker.updateBuffs();
      attacker.basicAttack.update();

      expect(attacker.basicAttack.target, Control.name).toBe(target);
      expect(pending(game), Control.name).toHaveLength(1);
    }
  });

  it('clears CAN_ATTACK for the crowd control that takes a unit over', () => {
    const stats = new Stats();
    for (const flag of [
      StatusFlags.Disarmed,
      StatusFlags.Stunned,
      StatusFlags.Charmed,
      StatusFlags.Feared,
      StatusFlags.Suppressed,
    ]) {
      stats.updateActionState(flag);
      expect(stats.getActionState(ActionState.CAN_ATTACK)).toBe(false);
    }

    // a root or a silence stops other things, never the swing
    stats.updateActionState(StatusFlags.Rooted | StatusFlags.Silenced);
    expect(stats.getActionState(ActionState.CAN_ATTACK)).toBe(true);
  });

  // ------------------------------------------------------------------ range

  it('walks into surface-to-surface reach before it swings', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    // reach is 300 of range plus half of each 55-unit body
    const reach = attacker.basicAttack.reachTo(champion(game, 0));
    expect(reach).toBeCloseTo(355);

    const target = champion(game, reach + 5);
    attacker.orderAttack(target);
    attacker.basicAttack.update();

    expect(pending(game)).toHaveLength(0);
    expect(attacker.destination).toMatchObject({ x: reach + 5, y: 0 });

    target.position.set(reach - 5, 0);
    attacker.basicAttack.update();

    expect(pending(game)).toHaveLength(1);
    expect(pending(game)[0]).toBeInstanceOf(BasicAttackBolt);
    // and it stopped walking once it was in reach
    expect(attacker.destination).toMatchObject({ x: 0, y: 0 });
  });

  it('gives an order up when the target outruns the attacker sight', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 100);
    attacker.orderAttack(target);

    target.position.set(attacker.stats.visionRadius.value + 100, 0);
    attacker.basicAttack.update();

    expect(attacker.basicAttack.target).toBeNull();
    expect(attacker.basicAttack.lastEnd).toBe('LOST');
    expect(pending(game)).toHaveLength(0);
  });

  it('gives an order up when the target dies, and reports why', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 100);
    attacker.orderAttack(target);
    target.die({ reviveAfter: 1_000 });

    attacker.basicAttack.update();

    expect(attacker.basicAttack.target).toBeNull();
    expect(attacker.basicAttack.lastEnd).toBe('KILLED');
  });

  // --------------------------------------------------------------- interval

  it('respects the attack interval between swings', () => {
    const game = createGame();
    const attacker = champion(game, 0, { damage: 5, attacksPerSecond: 2, range: 300 });
    const target = champion(game, 100);
    attacker.orderAttack(target);
    expect(attacker.basicAttack.intervalMs).toBe(500);

    vi.stubGlobal('deltaTime', 100);
    for (let frame = 0; frame < 11; frame++) attacker.basicAttack.update();

    // 1100ms of swinging at one per 500ms
    expect(pending(game)).toHaveLength(3);
  });

  // ------------------------------------------------------- ranged delivery

  it('damages a ranged target on arrival and not before', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 200);
    attacker.orderAttack(target);
    attacker.basicAttack.update();

    const bolt = pending(game)[0];
    if (!(bolt instanceof BasicAttackBolt)) throw new Error('expected a bolt');
    expect(bolt.speed).toBe(RANGED_BOLT_SPEED);
    expect(bolt.maxHitCount).toBe(0);

    for (let frame = 0; frame < 10; frame++) bolt.update();
    expect(target.stats.health.value).toBe(100);
    expect(bolt.position.x).toBeGreaterThan(0);
    expect(bolt.position.x).toBeLessThan(200);

    for (let frame = 0; frame < 30 && !bolt.toRemove; frame++) bolt.update();

    expect(bolt.toRemove).toBe(true);
    expect(target.stats.health.value).toBe(100 - DEFAULT_CHAMPION_ATTACK.damage);
  });

  it('lands nothing when the target dies while the bolt is in the air', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 200);
    const hits: BasicAttackHit[] = [];
    game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => hits.push(hit));

    attacker.orderAttack(target);
    attacker.basicAttack.update();
    const bolt = pending(game)[0] as BasicAttackBolt;

    bolt.update();
    target.die({ reviveAfter: 1_000 });
    for (let frame = 0; frame < 40 && !bolt.toRemove; frame++) bolt.update();

    expect(bolt.toRemove).toBe(true);
    expect(hits).toHaveLength(0);
  });

  it('lands nothing when the target goes untargetable while the bolt is in the air', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 200);
    attacker.orderAttack(target);
    attacker.basicAttack.update();
    const bolt = pending(game)[0] as BasicAttackBolt;

    bolt.update();
    target.setStatus(StatusFlags.Targetable, false);
    expect(target.targetable).toBe(false);
    for (let frame = 0; frame < 40 && !bolt.toRemove; frame++) bolt.update();

    expect(target.stats.health.value).toBe(100);
  });

  it('lands nothing when the attacker dies while the bolt is in the air', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 200);
    attacker.orderAttack(target);
    attacker.basicAttack.update();
    const bolt = pending(game)[0] as BasicAttackBolt;

    attacker.die({ reviveAfter: 1_000 });
    for (let frame = 0; frame < 40 && !bolt.toRemove; frame++) bolt.update();

    expect(target.stats.health.value).toBe(100);
  });

  // -------------------------------------------------------- melee delivery

  it('winds a melee swing up before it resolves', () => {
    const game = createGame();
    const attacker = champion(game, 0, MELEE);
    const target = champion(game, 100);
    attacker.orderAttack(target);
    attacker.basicAttack.update();

    const swing = pending(game)[0];
    if (!(swing instanceof BasicAttackSwing)) throw new Error('expected a swing');

    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS - 20);
    swing.update();
    expect(swing.struck).toBe(false);
    expect(target.stats.health.value).toBe(100);

    swing.update();
    expect(swing.struck).toBe(true);
    expect(target.stats.health.value).toBe(100 - MELEE.damage);

    vi.stubGlobal('deltaTime', MELEE_SWING_TOTAL_MS);
    swing.update();
    expect(swing.toRemove).toBe(true);
  });

  it('cancels a melee swing when the target leaves reach during the wind-up', () => {
    const game = createGame();
    const attacker = champion(game, 0, MELEE);
    const target = champion(game, 100);
    attacker.orderAttack(target);
    attacker.basicAttack.update();
    const swing = pending(game)[0] as BasicAttackSwing;

    target.position.set(900, 0);
    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS);
    swing.update();

    expect(swing.struck).toBe(true);
    expect(target.stats.health.value).toBe(100);
  });

  it('cancels a melee swing when the attacker is disarmed during the wind-up', () => {
    const game = createGame();
    const attacker = champion(game, 0, MELEE);
    const target = champion(game, 100);
    attacker.orderAttack(target);
    attacker.basicAttack.update();
    const swing = pending(game)[0] as BasicAttackSwing;

    attacker.addBuff(new Disarm(1_000, attacker, attacker));
    attacker.updateBuffs();
    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS);
    swing.update();

    expect(target.stats.health.value).toBe(100);
  });

  // ----------------------------------------------------------- the on-hit seam

  it('emits ON_ATTACK when the swing starts and ON_ATTACK_HIT when it lands', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 100);
    const started: unknown[] = [];
    const hits: BasicAttackHit[] = [];
    game.eventManager.on(EventType.ON_ATTACK, (unit: unknown) => started.push(unit));
    game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => hits.push(hit));

    attacker.orderAttack(target);
    attacker.basicAttack.update();

    // the swing has started but nothing has landed yet
    expect(started).toEqual([attacker]);
    expect(hits).toHaveLength(0);

    const bolt = pending(game)[0] as BasicAttackBolt;
    for (let frame = 0; frame < 40 && !bolt.toRemove; frame++) bolt.update();

    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      attacker,
      victim: target,
      damage: DEFAULT_CHAMPION_ATTACK.damage,
      ranged: true,
      // `crit` joined the payload with the crit roll. False, not absent: this
      // champion has no `critChance`, so the roll never happens.
      crit: false,
    });
  });

  it('reports a melee landing as a melee landing', () => {
    const game = createGame();
    const attacker = champion(game, 0, MELEE);
    const target = champion(game, 100);
    const hits: BasicAttackHit[] = [];
    game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => hits.push(hit));

    attacker.orderAttack(target);
    attacker.basicAttack.update();
    const swing = pending(game)[0] as BasicAttackSwing;
    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS);
    swing.update();

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ranged: false, damage: MELEE.damage });
  });

  // ------------------------------------------------------------ dead attacker

  it('stops a dead attacker and drops its order', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 100);
    attacker.orderAttack(target);
    attacker.die({ reviveAfter: 1_000 });

    attacker.basicAttack.update();

    expect(attacker.basicAttack.target).toBeNull();
    expect(pending(game)).toHaveLength(0);
  });

  it('refuses an order on itself, on its own team, and on a corpse', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const ally = new Champion({ game, position: createVector(50, 0), teamId: attacker.teamId });
    const corpse = champion(game, 100);
    corpse.die({ reviveAfter: 1_000 });

    attacker.orderAttack(attacker);
    expect(attacker.basicAttack.target).toBeNull();
    attacker.orderAttack(ally);
    expect(attacker.basicAttack.target).toBeNull();
    attacker.orderAttack(corpse);
    expect(attacker.basicAttack.target).toBeNull();
  });

  it('cancels the attack order when a move order arrives', () => {
    const game = createGame();
    const attacker = champion(game, 0);
    const target = champion(game, 100);
    attacker.orderAttack(target);

    attacker.orderMove(400, 400);

    expect(attacker.basicAttack.target).toBeNull();
    expect(attacker.basicAttack.lastEnd).toBe('CLEARED');
    expect(attacker.destination).toMatchObject({ x: 400, y: 400 });
  });

  // ---------------------------------------------------------------------- AI

  it('picks the nearest hostile champion and only re-scans on its interval', () => {
    const game = createGame();
    const ai = new AIChampion({ game, position: createVector(0, 0), teamId: 'ai' });
    game.setPlayer(ai);
    const near = champion(game, 200);
    const far = champion(game, 400);
    indexObjects(game, [ai, near, far]);
    const scan = vi.spyOn(ai, 'findAttackTarget');

    ai._attackScanCooldown = 0;
    ai.updateAttackTargeting();
    expect(ai.basicAttack.target).toBe(near);
    expect(scan).toHaveBeenCalledTimes(1);

    // an order already running is left alone, and the interval gates the query
    ai.updateAttackTargeting();
    expect(scan).toHaveBeenCalledTimes(1);

    ai.basicAttack.clear();
    ai.updateAttackTargeting();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(ai._attackScanCooldown).toBeGreaterThan(0);
    expect(ai._attackScanCooldown).toBeLessThanOrEqual(AI_ATTACK_SCAN_INTERVAL_MS);

    // ignores what it cannot reach
    far.position.set(4_000, 0);
    indexObjects(game, [ai, far]);
    ai._attackScanCooldown = 0;
    ai.updateAttackTargeting();
    expect(ai.basicAttack.target).toBeNull();
  });

  it('hits back at a champion that damaged it', () => {
    const game = createGame();
    const ai = new AIChampion({ game, position: createVector(0, 0), teamId: 'ai' });
    game.setPlayer(ai);
    const aggressor = champion(game, 300);

    ai.takeDamage(10, aggressor);

    expect(ai.basicAttack.target).toBe(aggressor);
  });

  it('does not scan while it is dead', () => {
    const game = createGame();
    const ai = new AIChampion({ game, position: createVector(0, 0), teamId: 'ai' });
    game.setPlayer(ai);
    indexObjects(game, [ai, champion(game, 200)]);
    ai.die({ reviveAfter: 1_000 });

    ai._attackScanCooldown = 0;
    ai.updateAttackTargeting();

    expect(ai.basicAttack.target).toBeNull();
  });
});
