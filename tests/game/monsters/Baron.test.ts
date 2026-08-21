/**
 * Baron's kit. The numbers live in `Baron.ts` and are imported here rather than
 * copied, so retuning the fight stays "edit the constant" instead of "edit a
 * test" — the same rule spells follow.
 *
 * The budget these were picked against: a champion pool is 100 health. Eating
 * the whole combo once is 18 + 12 + 22 + up to 30, which kills from full in
 * about six seconds of standing still. Every point of it is dodgeable — the
 * spit is a skillshot, the slam telegraphs for 600ms before it lands, and the
 * pool is ground you can walk off. Only the 12-damage bite is unavoidable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Airborne from '../../../src/game/gameObject/buffs/Airborne';
import DamageOverTime from '../../../src/game/gameObject/buffs/DamageOverTime';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane } from '../../../src/game/lanes';
import { monsterFillingSlot, monsterPresetFromSlot } from '../../../src/game/preset';
import { summonersRiftGeometry } from '../../../src/content/maps/summonersRiftGeometry';
import {
  BARON_ABILITIES,
  BaronPoisonPool,
  BaronPoisonSpit,
  BaronTailSlam,
  POOL,
  SLAM,
  SPIT,
} from '../../../src/game/gameObject/monsters/Baron';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

// The real neutral slot and the real installed monster that fills it, read
// through the same `preset.ts` seam `Game.spawnJungle()` uses — not a
// hand-rolled preset — so this test stays honest against what a match
// actually spawns. See `preset.ts`'s `monsterPresetFromSlot` doc comment.
const baronSlot = summonersRiftGeometry.slots.neutral.find(slot => slot.role === 'baron')!;
const baronPreset = () => monsterPresetFromSlot(monsterFillingSlot(baronSlot)!, baronSlot);

const makeBaron = () =>
  new Monster({ game, preset: baronPreset() } as ConstructorParameters<typeof Monster>[0]);

const championAt = (x: number, y: number, teamId = 'other') => {
  const champion = new Champion({ game, teamId });
  champion.position.set(x, y);
  champion.destination.set(x, y);
  return champion;
};

const minionAt = (x: number, y: number) =>
  new Minion({
    game,
    teamId: TeamId.BLUE,
    position: createVector(x, y),
    waypoints: [{ x, y }],
    lane: Lane.MID,
  } as never);

const tick = (unit: { update(): void }, frames: number) => {
  for (let i = 0; i < frames; i++) unit.update();
};

const framesFor = (ms: number) => Math.ceil(ms / 16) + 1;

describe("Baron's kit", () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('the auto attack it is built around', () => {
    it('bites for a fraction of a champion, not a quarter of one', () => {
      expect(baronPreset().damage).toBe(12);
    });
  });

  describe('poison spit', () => {
    it('damages what it hits and leaves poison behind', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 200, baron.camp.y);
      indexObjects(game, [baron, victim]);
      const health = victim.stats.health.value;

      const spit = new BaronPoisonSpit(baron);
      spit.destination.set(victim.position.x, victim.position.y);
      tick(spit, Math.ceil(200 / SPIT.speed) + 10);

      expect(victim.stats.health.value).toBeLessThanOrEqual(health - SPIT.damage);
      const poison = victim.buffs.find(b => b instanceof DamageOverTime) as DamageOverTime;
      if (!poison) throw new Error('The spit must leave a poison behind.');
      expect(poison.duration).toBe(SPIT.poisonDurationMs);
      expect(poison.damagePerTick * (SPIT.poisonDurationMs / poison.tickInterval)).toBe(
        SPIT.poisonTotal
      );
    });

    it('poisons a minion the same as a champion', () => {
      const baron = makeBaron();
      const victim = minionAt(baron.camp.x + 200, baron.camp.y);
      indexObjects(game, [baron, victim]);

      const spit = new BaronPoisonSpit(baron);
      spit.destination.set(victim.position.x, victim.position.y);
      tick(spit, Math.ceil(200 / SPIT.speed) + 10);

      expect(victim.buffs.some(b => b instanceof DamageOverTime)).toBe(true);
    });
  });

  describe('tail slam', () => {
    it('does nothing at all while it is still telegraphing', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 100, baron.camp.y);
      indexObjects(game, [baron, victim]);
      const health = victim.stats.health.value;

      const slam = new BaronTailSlam(baron);
      tick(slam, framesFor(SLAM.telegraphMs) - 3);

      expect(victim.stats.health.value).toBe(health);
      expect(victim.hasBuff(Airborne)).toBe(false);
    });

    it('damages and knocks up everything inside it when it lands', () => {
      const baron = makeBaron();
      const champion = championAt(baron.camp.x + 100, baron.camp.y);
      const minion = minionAt(baron.camp.x - 120, baron.camp.y);
      indexObjects(game, [baron, champion, minion]);
      const health = champion.stats.health.value;

      const slam = new BaronTailSlam(baron);
      tick(slam, framesFor(SLAM.telegraphMs));

      expect(champion.stats.health.value).toBe(health - SLAM.damage);
      expect(champion.hasBuff(Airborne)).toBe(true);
      expect(minion.hasBuff(Airborne)).toBe(true);
    });

    it('leaves anything standing outside the ring alone', () => {
      const baron = makeBaron();
      const safe = championAt(baron.camp.x + SLAM.radius + 80, baron.camp.y);
      indexObjects(game, [baron, safe]);
      const health = safe.stats.health.value;

      const slam = new BaronTailSlam(baron);
      tick(slam, framesFor(SLAM.telegraphMs));

      expect(safe.stats.health.value).toBe(health);
      expect(safe.hasBuff(Airborne)).toBe(false);
    });

    it('lands exactly once, however long it lingers', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 100, baron.camp.y);
      indexObjects(game, [baron, victim]);
      const health = victim.stats.health.value;

      const slam = new BaronTailSlam(baron);
      tick(slam, framesFor(SLAM.telegraphMs) + 40);

      expect(victim.stats.health.value).toBe(health - SLAM.damage);
    });
  });

  describe('poison pool', () => {
    it('slows whatever is standing in it', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 300, baron.camp.y);
      indexObjects(game, [baron, victim]);

      const pool = new BaronPoisonPool(baron, { x: victim.position.x, y: victim.position.y });
      pool.update(16);

      expect(victim.hasBuff(Slow)).toBe(true);
    });

    /**
     * It slows you, it does not shove you. `Slow.percent` is a fraction, and
     * this shipped as `35` — meaning -3500% speed, a negative `speed.value`,
     * and a `move()` that walked champions *away* from wherever they were
     * heading. In game the pool looked like a solid object pushing you out.
     */
    it('leaves a champion able to walk into it', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 300, baron.camp.y);
      indexObjects(game, [baron, victim]);

      const pool = new BaronPoisonPool(baron, { x: victim.position.x, y: victim.position.y });
      pool.update(16);
      victim.updateBuffs();
      victim.stats.update();

      expect(POOL.slowPercent).toBeLessThan(1);
      expect(victim.stats.speed.value).toBeGreaterThan(0);
      expect(victim.stats.speed.value).toBeLessThan(victim.stats.speed.baseValue);
    });

    it('still moves a slowed champion towards where it was sent', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 300, baron.camp.y);
      indexObjects(game, [baron, victim]);

      const pool = new BaronPoisonPool(baron, { x: victim.position.x, y: victim.position.y });
      pool.update(16);
      victim.moveTo(baron.camp.x, baron.camp.y);
      const before = victim.position.x;
      victim.update();

      // walking west, towards Baron — not east, away from it
      expect(victim.position.x).toBeLessThan(before);
    });

    it('ticks for its full total over its whole duration', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 300, baron.camp.y);
      victim.stats.maxHealth.baseValue = 1_000;
      victim.stats.health.baseValue = 1_000;
      indexObjects(game, [baron, victim]);
      const health = victim.stats.health.value;

      const pool = new BaronPoisonPool(baron, { x: victim.position.x, y: victim.position.y });
      for (let elapsed = 0; elapsed < POOL.durationMs; elapsed += 16) pool.update(16);

      expect(health - victim.stats.health.value).toBe(POOL.damagePerTick * POOL.ticks);
    });

    it('stops charging rent the moment you step off it', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 300, baron.camp.y);
      indexObjects(game, [baron, victim]);

      const pool = new BaronPoisonPool(baron, { x: victim.position.x, y: victim.position.y });
      pool.update(16);
      expect(victim.hasBuff(Slow)).toBe(true);

      victim.position.set(baron.camp.x + 3_000, baron.camp.y);
      indexObjects(game, [baron, victim]);
      pool.update(16);
      const health = victim.stats.health.value;
      for (let elapsed = 0; elapsed < POOL.durationMs; elapsed += 16) pool.update(16);

      expect(victim.stats.health.value).toBe(health);
    });
  });

  /**
   * The draw calls are the one part Vitest can only half-see: the stubs prove
   * every global these reach for exists and that the arithmetic survives both
   * phases, not that any of it looks right. That still catches the failure that
   * actually happens — a draw naming a p5 global that is not there, which throws
   * on the first frame the thing is on screen and takes the render loop with it.
   *
   * `frameCount` is stubbed here rather than in `stubGameGlobals` because it is
   * a frame counter, and a test that wants a specific frame should say which.
   */
  describe('every effect survives being drawn', () => {
    beforeEach(() => vi.stubGlobal('frameCount', 120));

    it('draws the spit in flight', () => {
      const baron = makeBaron();
      indexObjects(game, [baron]);
      const spit = new BaronPoisonSpit(baron);
      spit.destination.set(baron.camp.x + 300, baron.camp.y);

      expect(() => spit.draw()).not.toThrow();
    });

    it('draws the slam through both its telegraph and its burst', () => {
      const baron = makeBaron();
      indexObjects(game, [baron]);
      const slam = new BaronTailSlam(baron);

      expect(() => slam.draw()).not.toThrow();
      tick(slam, framesFor(SLAM.telegraphMs));
      expect(slam.landed).toBe(true);
      expect(() => slam.draw()).not.toThrow();
    });

    it('draws the pool at both ends of its life', () => {
      const baron = makeBaron();
      indexObjects(game, [baron]);
      const pool = new BaronPoisonPool(baron, { x: baron.camp.x, y: baron.camp.y });

      expect(() => pool.draw()).not.toThrow();
      for (let elapsed = 0; elapsed < POOL.durationMs; elapsed += 16) pool.update(16);
      expect(() => pool.draw()).not.toThrow();
    });

    it('gives the slam and the pool bounds wide enough not to be culled early', () => {
      const baron = makeBaron();
      indexObjects(game, [baron]);
      const slam = new BaronTailSlam(baron);
      const pool = new BaronPoisonPool(baron, { x: baron.camp.x, y: baron.camp.y });

      // both reach far past Baron's 100px body, which is exactly why they are
      // their own objects rather than something Monster.draw() paints
      expect(slam.getDisplayBoundingBox().w).toBeGreaterThanOrEqual(SLAM.radius * 2);
      expect(pool.getDisplayBoundingBox().w).toBeGreaterThanOrEqual(POOL.radius * 2);
    });
  });

  describe('the kit as the preset declares it', () => {
    it('is the three abilities, on the cooldowns they were tuned to', () => {
      expect(BARON_ABILITIES.map(a => a.cooldownMs)).toEqual([
        SPIT.cooldownMs,
        SLAM.cooldownMs,
        POOL.cooldownMs,
      ]);
    });

    it('is what the Baron preset actually carries', () => {
      expect(baronPreset().abilities).toBe(BARON_ABILITIES);
    });

    it('each cast puts its own object into the world', () => {
      const baron = makeBaron();
      const victim = championAt(baron.camp.x + 100, baron.camp.y);
      indexObjects(game, [baron, victim]);

      for (const ability of BARON_ABILITIES) ability.cast(baron, victim);

      const spawned = game.objectManager._objectToBeAdd;
      expect(spawned.some(o => o instanceof BaronPoisonSpit)).toBe(true);
      expect(spawned.some(o => o instanceof BaronTailSlam)).toBe(true);
      expect(spawned.some(o => o instanceof BaronPoisonPool)).toBe(true);
    });

    it('only slams when you are close enough to be worth slamming', () => {
      const slam = BARON_ABILITIES.find(a => a.name === SLAM.name);
      expect(slam?.range).toBe(SLAM.radius);
    });
  });
});
