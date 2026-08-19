import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain } from '../../../src/game/ai/BotBrain';
import { profileFor } from '../../../src/game/ai/Difficulty';
import Invisible from '../../../src/game/gameObject/buffs/Invisible';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import Untargetable from '../../../src/game/gameObject/buffs/Untargetable';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};

const BLUE = 'team-blue';
const RED = 'team-red';

const spawnBot = (game: TestGame, difficulty: 'easy' | 'normal' | 'hard', x = 0, y = 0) => {
  const bot = new AIChampion({
    game,
    position: createVector(x, y),
    teamId: BLUE,
    preset: PRESET,
    difficulty,
  });
  return bot;
};

const spawnEnemy = (game: TestGame, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId: RED, preset: PRESET });

describe('BotBrain perception', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('sees an enemy inside its aggro range', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const enemy = spawnEnemy(game, 300, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    expect(new BotBrain(bot).canPerceive(enemy)).toBe(true);
  });

  it('does not see an enemy past its aggro range — at ANY difficulty', () => {
    const game = createGame();
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const bot = spawnBot(game, tier);
      // one pixel beyond the tier's own reach
      const enemy = spawnEnemy(game, profileFor(tier).aggroRange + 1, 0);
      game.setPlayer(bot);
      indexObjects(game, [bot, enemy]);
      expect(new BotBrain(bot).canPerceive(enemy)).toBe(false);
    }
  });

  it('never sees a stealthed enemy, however high the difficulty', () => {
    // `isStealthed` is a getter on `AttackableUnit.prototype`, so
    // `vi.spyOn(instance, 'isStealthed', 'get')` throws — spyOn reads an
    // own-property descriptor. Set the STEALTHED action-state flag the way
    // `tests/game/combat/Stealth.test.ts` already does in this repo; follow
    // that file's idiom rather than inventing a second one.
    const game = createGame();
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const bot = spawnBot(game, tier);
      const enemy = spawnEnemy(game, 200, 0);
      // The repo's own idiom — `tests/game/combat/Stealth.test.ts:34-39`.
      // Do NOT use `vi.spyOn(enemy, 'isStealthed', 'get')`: the getter lives on
      // `AttackableUnit.prototype` and spyOn reads an own-property descriptor.
      enemy.addBuff(new Invisible(5_000, enemy, enemy));
      enemy.updateBuffs();
      expect(enemy.isStealthed).toBe(true);
      game.setPlayer(bot);
      indexObjects(game, [bot, enemy]);
      expect(new BotBrain(bot).canPerceive(enemy)).toBe(false);
    }
  });

  it('never perceives an enemy nothing is allowed to target', () => {
    // `pickTarget` walks `view.enemies` and carries no filter of its own — the
    // quadtree path gets `targetable` free from `canTakeDamageFromTeam`, and
    // this path had nothing. So a bot chased and cast at a champion holding
    // `Untargetable` (Fizz E, a Zed shadow): the UNIT resolve fizzles and the
    // skillshot is spent mana.
    const game = createGame();
    const bot = spawnBot(game, 'hard'); // the tier that skips the most gates
    const enemy = spawnEnemy(game, 200, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    const brain = new BotBrain(bot);
    expect(brain.canPerceive(enemy)).toBe(true); // ...until it is untargetable

    enemy.addBuff(new Untargetable(5_000, enemy, enemy));
    enemy.updateBuffs();
    expect(enemy.targetable).toBe(false);

    expect(brain.canPerceive(enemy)).toBe(false);
    expect(
      brain.pickTarget({
        allies: [],
        enemies: [enemy],
        focusTarget: null,
        rally: null,
        memory: new Map(),
        lanes: new Map(),
        laneAssignments: new Map(),
        enemyTurrets: [],
      })
    ).toBeNull();
  });

  it('scans for a target once per think tick, not twice', () => {
    // `think` called `pickTarget` and then `decidePosture` called it again, and
    // each pass costs a `canSee` raycast per living enemy — at every tier now
    // that none of them skips the terrain question.
    const game = createGame();
    const bot = spawnBot(game, 'easy');
    const enemy = spawnEnemy(game, 200, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);
    // Neither of these is under test here, and both would drag in pathing.
    bot._autoMove = false;
    bot._autoCast = false;

    const brain = new BotBrain(bot);
    let looks = 0;
    brain.sees = () => {
      looks++;
      return true;
    };

    brain.update(1_000, 16);
    expect(looks).toBe(1);
  });

  it('lets no tier acquire a target it cannot see', () => {
    // `normal` and `hard` used to skip the terrain question outright, so every
    // bot in every default match acquired through walls and bushes. Reported
    // from a real match as "a bot autoattacked me while neither of us had
    // vision", and it is the one acquisition path in the game that did that:
    // minions, monsters, pets, turrets and the player's own right click all go
    // through `PredefinedFilters.visibleTo`.
    const game = createGame();
    const enemy = spawnEnemy(game, 200, 0);
    game.setPlayer(spawnBot(game, 'normal'));

    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const bot = spawnBot(game, tier);
      indexObjects(game, [bot, enemy]);

      const blind = new BotBrain(bot);
      blind.sees = () => false;
      expect(blind.canPerceive(enemy), `${tier} acquired through terrain`).toBe(false);

      const looking = new BotBrain(bot);
      looking.sees = () => true;
      expect(looking.canPerceive(enemy), `${tier} refused a target in the open`).toBe(true);
    }
  });

  it('never sees a dead or removed enemy', () => {
    const game = createGame();
    const bot = spawnBot(game, 'hard');
    const dead = spawnEnemy(game, 100, 0);
    const gone = spawnEnemy(game, 120, 0);
    // `isDead` is a flag flipped inside `die()` (AttackableUnit.ts:570), NOT a
    // reading of the health stat — zeroing health leaves `isDead` false.
    dead.die({ reviveAfter: 999_999 });
    gone.toRemove = true;
    game.setPlayer(bot);
    indexObjects(game, [bot, dead, gone]);

    const brain = new BotBrain(bot);
    expect(brain.canPerceive(dead)).toBe(false);
    expect(brain.canPerceive(gone)).toBe(false);
  });
});

describe('BotBrain target choice', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const viewOf = (enemies: Champion[], focusTarget: Champion | null = null) => ({
    allies: [] as Champion[],
    enemies,
    focusTarget,
    rally: null,
    memory: new Map(),
  });

  it('takes the nearest when nothing else separates them', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const near = spawnEnemy(game, 100, 0);
    const far = spawnEnemy(game, 300, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, near, far]);

    expect(new BotBrain(bot).pickTarget(viewOf([far, near]))).toBe(near);
  });

  it('prefers the one closest to dying over the one closest to it', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const near = spawnEnemy(game, 100, 0);
    const wounded = spawnEnemy(game, 260, 0);
    near.stats.health.baseValue = 100;
    wounded.stats.health.baseValue = 5;
    game.setPlayer(bot);
    indexObjects(game, [bot, near, wounded]);

    // distance term: -100/100 = -1 vs -260/100 = -2.6, so 1.6 in the near one's
    // favour. low-health term: 12*(1-1.0)=0 vs 12*(1-0.05)=11.4. 11.4 > 1.6.
    expect(new BotBrain(bot).pickTarget(viewOf([near, wounded]))).toBe(wounded);
  });

  it('pulls toward whoever the team is already focusing', () => {
    const game = createGame();
    const bot = spawnBot(game, 'hard');
    const near = spawnEnemy(game, 100, 0);
    const focused = spawnEnemy(game, 300, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, near, focused]);

    // hard focusBonus is 14; the distance gap is (300-100)/100 = 2.
    expect(new BotBrain(bot).pickTarget(viewOf([near, focused], focused))).toBe(focused);
  });

  it('ignores an enemy it cannot perceive', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const visible = spawnEnemy(game, 400, 0);
    const tooFar = spawnEnemy(game, 5_000, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, visible, tooFar]);

    expect(new BotBrain(bot).pickTarget(viewOf([tooFar, visible]))).toBe(visible);
  });

  it('leans toward the human player, and only at tiers that say so', () => {
    // Needs a player who is NOT the bot: the fixtures call `setPlayer(bot)`, so
    // `enemy === game.player` was never true and this term had no test at all.
    const game = createGame();
    const bot = spawnBot(game, 'hard', 0, 0);
    const human = spawnEnemy(game, 300, 0);
    const otherBot = spawnEnemy(game, 260, 0);
    game.setPlayer(human);
    indexObjects(game, [bot, human, otherBot]);

    // hard playerBias is 12; the distance gap favours otherBot by only
    // (300-260)/100 = 0.4. Worked by hand.
    expect(new BotBrain(bot).pickTarget(viewOf([otherBot, human]))).toBe(human);

    // easy playerBias is 0, so the nearer one wins on distance alone.
    const easyBot = spawnBot(game, 'easy', 0, 0);
    expect(new BotBrain(easyBot).pickTarget(viewOf([otherBot, human]))).toBe(otherBot);
  });

  it('counts a shield when it judges how nearly dead an enemy is', () => {
    // `pickFocus` and the `Burst` check both read `effectiveHealth`; this term
    // read the raw pool, so one shielded enemy looked nearly dead to the target
    // picker and perfectly healthy to the burst check on the same tick.
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const healthy = spawnEnemy(game, 100, 0);
    const shielded = spawnEnemy(game, 260, 0);
    shielded.stats.health.baseValue = 5;
    const shield = new Shield(5_000, shielded, shielded);
    shield.amount = 95; // 5 + 95 is exactly `healthy`'s full pool
    shielded.addBuff(shield);
    shielded.updateBuffs();
    expect(shielded.shieldAmount).toBe(95);

    game.setPlayer(bot);
    indexObjects(game, [bot, healthy, shielded]);

    // Both now read as 100 effective health, so only distance separates them:
    // -100/100 = -1 against -260/100 = -2.6, by hand.
    expect(new BotBrain(bot).pickTarget(viewOf([shielded, healthy]))).toBe(healthy);
  });

  it('returns null when it can perceive nobody', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const tooFar = spawnEnemy(game, 5_000, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, tooFar]);

    expect(new BotBrain(bot).pickTarget(viewOf([tooFar]))).toBeNull();
  });
});
