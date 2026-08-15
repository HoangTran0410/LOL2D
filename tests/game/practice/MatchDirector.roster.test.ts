import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import { AI_COUNT_MAX, DEFAULT_CHAMPION_LOADOUT } from '../../../src/game/config/PregameConfig';
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
    expect(bot.behaviour).toEqual({ autoMove: false, autoAttack: true, autoCast: true });
  });

  it('a new bot is not in the world until the paused match ticks again', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);

    director.addBot(DEFAULT_CHAMPION_LOADOUT);
    expect(director.roster()).toHaveLength(1);

    game.objectManager.update();
    expect(director.roster()).toHaveLength(2);
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

  it('setBotBehaviour writes only the flags it is given', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    director.setBotBehaviour(bot, { autoMove: true });

    const entry = director.roster().find(e => e.unit === bot)!;
    expect(entry.behaviour).toEqual({ autoMove: true, autoAttack: true, autoCast: true });
  });

  it('setBotBehaviour turns a flag off as readily as on', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(DEFAULT_CHAMPION_LOADOUT)!;
    game.objectManager.update();

    director.setBotBehaviour(bot, { autoAttack: false, autoCast: false });

    const entry = director.roster().find(e => e.unit === bot)!;
    expect(entry.behaviour).toEqual({ autoMove: false, autoAttack: false, autoCast: false });
  });
});
