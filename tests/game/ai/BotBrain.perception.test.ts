import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain } from '../../../src/game/ai/BotBrain';
import { profileFor } from '../../../src/game/ai/Difficulty';
import Invisible from '../../../src/game/gameObject/buffs/Invisible';
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

  it('lets normal and hard bots see through terrain, and stops easy ones', () => {
    const game = createGame();
    const bot = spawnBot(game, 'easy');
    const enemy = spawnEnemy(game, 200, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);

    const brain = new BotBrain(bot);
    // The terrain answer is the ONLY thing that differs between the tiers.
    brain.sees = () => false;
    expect(brain.canPerceive(enemy)).toBe(false);

    const normalBot = spawnBot(game, 'normal');
    const normalBrain = new BotBrain(normalBot);
    normalBrain.sees = () => false;
    expect(normalBrain.canPerceive(enemy)).toBe(true);
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

  it('returns null when it can perceive nobody', () => {
    const game = createGame();
    const bot = spawnBot(game, 'normal');
    const tooFar = spawnEnemy(game, 5_000, 0);
    game.setPlayer(bot);
    indexObjects(game, [bot, tooFar]);

    expect(new BotBrain(bot).pickTarget(viewOf([tooFar]))).toBeNull();
  });
});
