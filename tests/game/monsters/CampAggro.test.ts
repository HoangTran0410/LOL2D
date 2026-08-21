import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A camp is a pack, not three strangers standing near each other. Hitting one
 * wolf used to wake exactly that wolf: the other two watched their packmate die
 * from a metre away, because `takeDamage` is the only thing that aggros a camp
 * and it only ever aggroed the unit it was called on.
 *
 * Pack membership used to be a shared `campId` string every body carried.
 * That field is gone (Task 7: a camp is a slot, a monster is a thing that
 * fills it) — membership is now "spawned with the same `camp` object", the
 * way `Game.spawnJungle()` actually builds a multi-body camp (`preset.ts`'s
 * `monsterPresetFromSlot`: one preset per slot, reused for every body). So a
 * "pack" here is bodies that share one `camp` object literal; bodies that
 * happen to sit near each other with *different* `camp` objects are not a
 * pack, same as two neighbouring solo camps never were.
 */

const PACK = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeWolf = (
  camp: { x: number; y: number; r: number },
  overrides: Record<string, unknown> = {}
) =>
  new Monster({
    game,
    preset: {
      name: 'Wolf',
      avatar: 'monster_Murk_Wolf',
      camp,
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
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
    const camp = { ...PACK };
    const leader = makeWolf(camp, { health: 300, size: 70 });
    const a = makeWolf(camp);
    const b = makeWolf(camp);
    // Distinct starting positions, same as `Game.spawnJungle()` nudges a
    // multi-body camp off its exact camp point — the pack test is about
    // `camp` identity, not about every body standing on the same pixel.
    a.position.set(PACK.x - 83, PACK.y - 51);
    b.position.set(PACK.x + 40, PACK.y + 97);
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
    const camp = { ...PACK };
    const doomed = makeWolf(camp, { health: 10 });
    const mate = makeWolf(camp);
    mate.position.set(PACK.x + 60, PACK.y - 40);
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [doomed, mate, champion]);

    doomed.takeDamage(999, champion);

    expect(doomed.isDead).toBe(true);
    expect(mate.phase).toBe(Monster.PHASES.ATTACK);
    expect(mate.targetLock).toBe(champion);
  });

  it('leaves a neighbouring camp alone', () => {
    const wolfCamp = { ...PACK };
    // Close enough to be inside the alert radius, and not this camp's business
    // — a different `camp` object, even though the points sit near each other.
    const germCamp = { ...PACK, x: PACK.x + 200 };
    const wolf = makeWolf(wolfCamp);
    const gromp = makeWolf(germCamp);
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [wolf, gromp, champion]);

    wolf.takeDamage(10, champion);

    expect(wolf.phase).toBe(Monster.PHASES.ATTACK);
    expect(gromp.phase).toBe(Monster.PHASES.IDLE);
    expect(gromp.targetLock).toBeNull();
  });

  it('does not steal a packmate that is already fighting someone else', () => {
    const camp = { ...PACK };
    const wolf = makeWolf(camp);
    const mate = makeWolf(camp);
    mate.position.set(PACK.x + 60, PACK.y);
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
    // No id to omit any more — two distinct camp object literals, even at
    // points close enough to be inside each other's alert radius, are two
    // camps of one. Nothing ties them together.
    const alone = makeWolf({ ...PACK });
    const other = makeWolf({ ...PACK, x: PACK.x + 60 });
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(PACK.x + 60, PACK.y);
    indexObjects(game, [alone, other, champion]);

    alone.takeDamage(10, champion);

    expect(alone.phase).toBe(Monster.PHASES.ATTACK);
    expect(other.phase).toBe(Monster.PHASES.IDLE);
  });
});
