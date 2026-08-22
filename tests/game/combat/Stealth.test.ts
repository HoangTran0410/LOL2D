/**
 * Stealth has to hide you from everything that picks targets, not just from a
 * champion's right-click.
 *
 * `ActionState.STEALTHED` was read in exactly one place in the whole engine —
 * `BasicAttackController`, so a player could not *order* an attack on a
 * stealthed unit — and nowhere else. Every scan that acquires a target on its
 * own went through `canTakeDamageFromTeam`, which knows about teams, death and
 * targetability but not about being invisible. So Twitch Q dimmed the sprite to
 * alpha 20 and changed nothing: the wave, the camps, the turrets and the bots
 * all kept chasing and hitting a champion nobody could see.
 *
 * The bush rule (`visibleTo`) is deliberately left off the bots — see the note
 * on that filter. Stealth is the other case entirely: it is an ability the
 * player spent a cast and a cooldown on, and a bot that ignores it makes the
 * ability worthless against the only opponents in the match.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Turret from '../../../src/game/gameObject/structures/Turret';
import Invisible from '../../../src/game/gameObject/buffs/Invisible';
import TrueSight from '../../../src/game/gameObject/buffs/TrueSight';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

/** Puts a live stealth on `unit` and settles the status flags it implies. */
const vanish = (unit: Champion) => {
  unit.addBuff(new Invisible(5_000, unit, unit));
  unit.updateBuffs();
  expect(unit.isStealthed).toBe(true);
};

const reveal = (unit: Champion, revealer: Champion) => {
  unit.addBuff(new TrueSight(5_000, revealer, unit));
  unit.updateBuffs();
};

const makeMinion = (teamId: string, x: number, y = 0) =>
  new Minion({
    game,
    teamId,
    position: createVector(x, y),
    waypoints: getLaneWaypoints(Lane.MID, teamId),
    lane: Lane.MID,
  });

const makeCamp = () =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: TEST_AVATAR_KEY,
      camp: { ...CAMP },
      speed: 2,
      size: 80,
      attackRange: 50,
      reviveTime: 100,
      health: 300,
    },
  } as ConstructorParameters<typeof Monster>[0]);

describe('nothing acquires a target it cannot see', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a minion walks past a stealthed champion', () => {
    const minion = makeMinion(TeamId.BLUE, 0);
    const champion = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [minion, champion]);

    expect(minion.findTarget()).toBe(champion);

    vanish(champion);
    expect(minion.findTarget()).toBeNull();
  });

  it('a jungle camp drops a target that vanishes mid-fight', () => {
    // Camps no longer wake on proximity at all, so the stealth-relevant rule is
    // the other end: a camp already fighting a champion lets go the moment it
    // can no longer see them (updateAttack's isStealthed check).
    const camp = makeCamp();
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(CAMP.x + 40, CAMP.y);
    indexObjects(game, [camp, champion]);
    camp.aggroOn(champion);
    expect(camp.phase).toBe(Monster.PHASES.ATTACK);

    vanish(champion);
    camp.updateAttack();
    expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
    expect(camp.targetLock).toBeNull();
  });

  it('a turret holds its fire', () => {
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const champion = new Champion({ game, teamId: 'solo', position: createVector(120, 0) });
    indexObjects(game, [turret, champion]);

    expect(turret.findTarget()).toBe(champion);

    vanish(champion);
    expect(turret.findTarget()).toBeNull();
  });

  it('a bot loses interest too — the ability is spent on the bots more than anything', () => {
    const bot = new AIChampion({ game, teamId: 'bot', position: createVector(0, 0) });
    const champion = new Champion({ game, teamId: 'solo', position: createVector(150, 0) });
    indexObjects(game, [bot, champion]);

    expect(bot.findAttackTarget()).toBe(champion);

    vanish(champion);
    expect(bot.findAttackTarget()).toBeNull();
  });

  it('sees it again the moment true sight strips the stealth', () => {
    const minion = makeMinion(TeamId.BLUE, 0);
    const champion = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [minion, champion]);

    vanish(champion);
    expect(minion.findTarget()).toBeNull();

    reveal(champion, minion as never);
    expect(champion.isStealthed).toBe(false);
    expect(minion.findTarget()).toBe(champion);
  });
});

describe('a target that vanishes mid-fight is let go', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a minion drops the lock rather than keeping it until the next scan', () => {
    const minion = makeMinion(TeamId.BLUE, 0);
    const champion = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [minion, champion]);
    minion.targetLock = champion;
    minion.phase = Minion.PHASES.ATTACK;

    vanish(champion);
    minion.updateAttack();

    expect(minion.targetLock).toBeNull();
  });

  it('a camp goes home rather than swinging at nothing', () => {
    const camp = makeCamp();
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(CAMP.x + 40, CAMP.y);
    indexObjects(game, [camp, champion]);
    camp.aggroOn(champion);
    camp._attackCooldown = 0;
    const health = champion.stats.health.value;

    vanish(champion);
    camp.updateAttack();

    expect(camp.targetLock).toBeNull();
    expect(champion.stats.health.value).toBe(health);
  });
});
