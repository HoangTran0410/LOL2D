import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } from '../../../src/game/config/PregameConfig';
import TeamId from '../../../src/game/enums/TeamId';
import { context } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('MatchDirector roster', () => {
  it('lists the player first, then every live bot in spawn order', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    const first = director.addBot(DEFAULT_CHAMPION_LOADOUT);
    const second = director.addBot(DEFAULT_CHAMPION_LOADOUT);
    game.objectManager.update();

    const roster = director.roster();
    expect(roster).toHaveLength(3);
    expect(roster[0].isPlayer).toBe(true);
    expect(roster[0].unit).toBe(ctx.player);
    expect(roster[1].unit).toBe(first);
    expect(roster[2].unit).toBe(second);
  });

  it('reports behaviour flags for bots and none for the player', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    director.addBot(DEFAULT_CHAMPION_LOADOUT);
    game.objectManager.update();

    const [player, bot] = director.roster();
    expect(player.behaviour).toBeUndefined();
    expect(bot.behaviour).toEqual({
      autoMove: true,
      autoAttack: true,
      autoCast: true,
      difficulty: 'normal',
    });
  });

  it('lists a new bot at once, before the paused match has ticked', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    director.addBot(DEFAULT_CHAMPION_LOADOUT);

    // The panel that calls `addBot` holds the match paused, so the flush that
    // moves the bot from `_objectToBeAdd` into `objects` cannot run until the
    // player closes it. A roster built from `objects` alone therefore did not
    // change as the player pressed "Thêm bot" — it showed them the pause rather
    // than their own edit, which is the exact argument the removal case already
    // makes below. Mirrored here.
    expect(director.roster()).toHaveLength(2);
    expect(game.objectManager.objects).toHaveLength(1);

    game.objectManager.update();
    expect(director.roster()).toHaveLength(2);
    expect(game.objectManager.objects).toHaveLength(2);
  });

  it('caps a paused session too, where no tick ever moves a bot into the world', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    let added = 0;
    for (let i = 0; i < AI_COUNT_MAX + 15; i++) {
      if (director.addBot(DEFAULT_CHAMPION_LOADOUT)) added++;
    }

    // The whole of a practice-panel session runs between two ticks. Counting
    // only the units the sweep had already delivered made `AI_COUNT_MAX`
    // unreachable here: 25 presses returned 25 bots and all of them arrived at
    // once on close.
    expect(added).toBe(AI_COUNT_MAX);
    expect(director.roster().filter(entry => !entry.isPlayer)).toHaveLength(AI_COUNT_MAX);
  });

  it('drops a queued bot that is removed before it ever reaches the world', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    director.removeBot(bot);

    expect(director.roster()).toHaveLength(1);
    game.objectManager.update();
    game.objectManager.update();
    expect(director.roster()).toHaveLength(1);
  });

  it('removeBot marks the unit and it leaves on the next tick', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    director.removeBot(bot);
    expect(bot.toRemove).toBe(true);

    game.objectManager.update();
    expect(director.roster()).toHaveLength(1);
  });

  it('drops a bot from the roster the moment it is marked, before the sweep runs', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    director.removeBot(bot);

    // The panel's own list has to stop showing a bot the player just removed,
    // and the match is paused, so the sweep that actually deletes it will not
    // run until the panel closes.
    expect(director.roster()).toHaveLength(1);
  });

  it('refuses to remove the player', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    director.removeBot(player);

    expect(player.toRemove).toBeFalsy();
    expect(director.roster()).toHaveLength(1);
  });

  it('caps the bot count at AI_COUNT_MAX, and says so by returning null', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    let refused = 0;
    for (let i = 0; i < AI_COUNT_MAX + 5; i++) {
      if (director.addBot(DEFAULT_CHAMPION_LOADOUT) === null) refused++;
      game.objectManager.update();
    }

    expect(director.roster().filter(entry => !entry.isPlayer)).toHaveLength(AI_COUNT_MAX);
    expect(refused).toBe(5);
  });

  it('frees a capped slot the moment a bot is marked, not when the sweep gets to it', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    for (let i = 0; i < AI_COUNT_MAX; i++) {
      director.addBot(DEFAULT_CHAMPION_LOADOUT);
      game.objectManager.update();
    }
    expect(director.addBot(DEFAULT_CHAMPION_LOADOUT)).toBeNull();

    director.removeBot(director.bots()[0]);
    expect(director.addBot(DEFAULT_CHAMPION_LOADOUT)).not.toBeNull();
  });

  it('spawns a bot at the spawn point the match hands it', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    expect(bot.position.x).toBe(500);
    expect(bot.position.y).toBe(500);
  });

  it('puts added bots on the less populated team and uses that team fountain', () => {
    const { context: ctx } = context();
    const spawn = vi.fn((teamId?: string) =>
      teamId === TeamId.BLUE ? createVector(200, 200) : createVector(800, 800)
    );
    ctx.randomSpawnPoint = spawn;
    const director = new MatchDirector(ctx);

    const first = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    const second = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    const third = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    // Blue starts one ahead because it owns the player slot. Once the teams
    // tie, the documented tie-break sends one more bot Red; Blue then catches up.
    expect([first.teamId, second.teamId, third.teamId]).toEqual([
      TeamId.RED,
      TeamId.RED,
      TeamId.BLUE,
    ]);
    expect(spawn.mock.calls.map(([teamId]) => teamId)).toEqual([
      TeamId.RED,
      TeamId.RED,
      TeamId.BLUE,
    ]);
    expect(first.position.x).toBe(800);
    expect(third.position.x).toBe(200);
  });

  it('does not count a removed bot when balancing its replacement', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);
    director.addBot(DEFAULT_CHAMPION_LOADOUT);
    director.addBot(DEFAULT_CHAMPION_LOADOUT);
    const blueBot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    director.removeBot(blueBot);
    const replacement = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;

    expect(blueBot.teamId).toBe(TeamId.BLUE);
    expect(replacement.teamId).toBe(TeamId.BLUE);
  });

  it('setBotBehaviour writes only the flags it is given', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    director.setBotBehaviour(bot, { autoMove: true });

    const entry = director.roster().find(e => e.unit === bot)!;
    expect(entry.behaviour).toEqual({
      autoMove: true,
      autoAttack: true,
      autoCast: true,
      difficulty: 'normal',
    });
  });

  /**
   * The fourth field, and the one that is not a boolean on the unit: it is
   * written through `AIChampion.setDifficulty`, the single writer for
   * `_difficulty`, so this asserts the live field as well as the roster view.
   */
  it('setBotBehaviour retunes how well a bot plays', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    expect(bot._difficulty).toBe('normal');
    director.setBotBehaviour(bot, { difficulty: 'hard' });

    expect(bot._difficulty).toBe('hard');
    const entry = director.roster().find(e => e.unit === bot)!;
    expect(entry.behaviour).toEqual({
      autoMove: true,
      autoAttack: true,
      autoCast: true,
      difficulty: 'hard',
    });
  });

  it('setBotBehaviour turns a flag off as readily as on', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    director.setBotBehaviour(bot, { autoAttack: false, autoCast: false });

    const entry = director.roster().find(e => e.unit === bot)!;
    expect(entry.behaviour).toEqual({
      autoMove: true,
      autoAttack: false,
      autoCast: false,
      difficulty: 'normal',
    });
  });
});
