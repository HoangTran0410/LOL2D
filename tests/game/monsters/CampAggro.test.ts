import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { MonsterPreset } from '../../../src/game/preset';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A camp is a pack, not three strangers standing near each other. Hitting one
 * wolf used to wake exactly that wolf: the other two watched their packmate die
 * from a metre away, because `takeDamage` is the only thing that aggros a camp
 * and it only ever aggroed the unit it was called on.
 */

const PACK = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeWolf = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Wolf',
      avatar: 'monster_Murk_Wolf',
      camp: { ...PACK },
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
      campId: 'wolf-test',
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

describe('camp aggro', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('wakes the whole pack when one of them is hit', () => {
    const leader = makeWolf({ camp: { ...PACK }, health: 300, size: 70 });
    const a = makeWolf({ camp: { ...PACK, x: PACK.x - 83, y: PACK.y - 51 } });
    const b = makeWolf({ camp: { ...PACK, x: PACK.x + 40, y: PACK.y + 97 } });
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [leader, a, b, champion]);

    leader.takeDamage(10, champion);

    for (const wolf of [leader, a, b]) {
      expect(wolf.phase).toBe(Monster.PHASES.ATTACK);
      expect(wolf.targetLock).toBe(champion);
    }
  });

  it('answers the hit that killed a packmate', () => {
    const doomed = makeWolf({ health: 10 });
    const mate = makeWolf({ camp: { ...PACK, x: PACK.x + 60 } });
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [doomed, mate, champion]);

    doomed.takeDamage(999, champion);

    expect(doomed.isDead).toBe(true);
    expect(mate.phase).toBe(Monster.PHASES.ATTACK);
    expect(mate.targetLock).toBe(champion);
  });

  it('leaves a neighbouring camp alone', () => {
    const wolf = makeWolf();
    // Close enough to be inside the alert radius, and not this camp's business.
    const gromp = makeWolf({ campId: 'gromp-test', camp: { ...PACK, x: PACK.x + 200 } });
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [wolf, gromp, champion]);

    wolf.takeDamage(10, champion);

    expect(wolf.phase).toBe(Monster.PHASES.ATTACK);
    expect(gromp.phase).toBe(Monster.PHASES.IDLE);
    expect(gromp.targetLock).toBeNull();
  });

  it('does not steal a packmate that is already fighting someone else', () => {
    const wolf = makeWolf();
    const mate = makeWolf({ camp: { ...PACK, x: PACK.x + 60 } });
    const champion = new Champion({ game, teamId: 'other' });
    const ally = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    ally.position.set(PACK.x - 60, PACK.y);
    indexObjects(game, [wolf, mate, champion, ally]);

    mate.aggroOn(ally);
    wolf.takeDamage(10, champion);

    expect(mate.targetLock).toBe(ally);
  });

  it('holds a camp of one to itself', () => {
    const alone = makeWolf({ campId: undefined });
    const other = makeWolf({ campId: undefined, camp: { ...PACK, x: PACK.x + 60 } });
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [alone, other, champion]);

    alone.takeDamage(10, champion);

    expect(alone.phase).toBe(Monster.PHASES.ATTACK);
    expect(other.phase).toBe(Monster.PHASES.IDLE);
  });

  /**
   * The behaviour above is worthless if the map data does not use it, and a
   * missing `campId` on a new camp member is invisible from `Monster.ts`. The
   * expected packs are written out by hand rather than derived from the presets
   * — a grouping asked to check its own grouping agrees with itself.
   */
  describe('the map data', () => {
    const PACKS: Record<string, string[]> = {
      wolf1: ['wolf1', 'wolf1_a', 'wolf1_b'],
      wolf2: ['wolf2', 'wolf2_a', 'wolf2_b'],
      raptor1: ['raptor1', 'raptor1_a', 'raptor1_b', 'raptor1_c'],
      raptor2: ['raptor2', 'raptor2_a', 'raptor2_b', 'raptor2_c'],
    };
    /** Every other camp is one body, and must stay a camp of one. */
    const LONERS = ['baron', 'blue1', 'blue2', 'red1', 'red2', 'gomp1', 'gomp2'];

    it('groups the wolves and the raptors, and nothing else', () => {
      for (const [campId, keys] of Object.entries(PACKS)) {
        for (const key of keys) expect([key, MonsterPreset[key]?.campId]).toEqual([key, campId]);
      }
      for (const key of LONERS) {
        expect([key, MonsterPreset[key]?.campId]).toEqual([key, undefined]);
      }
      // and no camp key is left out of both lists
      const named = new Set([...Object.values(PACKS).flat(), ...LONERS]);
      expect(Object.keys(MonsterPreset).filter(key => !named.has(key))).toEqual([]);
    });

    it('keeps every packmate inside the alert radius of the camp point', () => {
      for (const keys of Object.values(PACKS)) {
        const anchor = MonsterPreset[keys[0]].camp;
        for (const key of keys) {
          const { x, y } = MonsterPreset[key].camp;
          // `alertCamp` queries `chaseLeashRange()` = max(camp.r, aggroRange) +
          // MONSTER_CHASE_MARGIN around the camp point; every pack here is a
          // 300px pit, so 650. Measured against a hand-written 400 to leave the
          // margin visible rather than restating the formula.
          expect([key, Math.round(Math.hypot(x - anchor.x, y - anchor.y))][1]).toBeLessThan(400);
        }
      }
    });
  });
});
