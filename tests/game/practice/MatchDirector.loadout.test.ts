import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import { DEFAULT_CHAMPION_LOADOUT } from '../../../src/game/config/PregameConfig';
import type { ChampionLoadout } from '../../../src/game/config/PregameConfig';
import { context } from './helpers';

afterEach(() => vi.unstubAllGlobals());

// Named champions, never `championName: 'random'`: a random loadout re-resolves
// to a different kit on every call, so "did the swap take" would be a coin toss
// and a respawn assertion would be meaningless.
const AHRI: ChampionLoadout = { ...DEFAULT_CHAMPION_LOADOUT, championName: 'Ahri' };
const ZED: ChampionLoadout = { ...DEFAULT_CHAMPION_LOADOUT, championName: 'Zed' };

describe('MatchDirector.applyLoadout', () => {
  it('keeps the unit exactly where it stands', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    player.position.set(1234, 5678);

    director.applyLoadout(player, ZED);

    expect(player.position.x).toBe(1234);
    expect(player.position.y).toBe(5678);
  });

  it('swaps the kit', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    director.applyLoadout(player, AHRI);
    const ahriSpells = player.spells.map(spell => spell.constructor.name);

    director.applyLoadout(player, ZED);

    expect(player.spells.map(spell => spell.constructor.name)).not.toEqual(ahriSpells);
  });

  it('takes the name and the attack profile from the new loadout too, not just the spells', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    player.stats.attackDamage.baseValue = 999;

    director.applyLoadout(player, ZED);

    expect(player.name).toBe('Zed');
    expect(player.stats.attackDamage.baseValue).not.toBe(999);
  });

  it('refills health and mana — trying a champion on 12 HP is not trying it', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    player.stats.health.baseValue = 12;
    player.stats.mana.baseValue = 3;

    director.applyLoadout(player, ZED);

    expect(player.stats.health.baseValue).toBe(player.stats.maxHealth.value);
    expect(player.stats.mana.baseValue).toBe(player.stats.maxMana.value);
  });

  it('hands over fresh spells, so nothing arrives mid-cooldown', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    director.applyLoadout(player, ZED);

    expect(player.spells.every(spell => spell.currentCooldown === 0)).toBe(true);
  });

  it('makes a bot keep its new champion across a respawn', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(AHRI)!;
    game.objectManager.update();

    director.applyLoadout(bot, ZED);
    const afterSwap = bot.name;
    bot.respawn();

    expect(afterSwap).toBe('Zed');
    expect(bot.name).toBe(afterSwap);
  });

  it('re-arms a bot that had been pinned, so the respawn reapplies the new loadout', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(AHRI)!;
    game.objectManager.update();
    // What the picker's "clone my spells" does: stop the respawn touching the
    // kit at all. A later swap has to undo it, or the bot comes back holding
    // the spells this loadout replaced.
    bot.setRespawnRollsNewPreset(false);

    director.applyLoadout(bot, ZED);
    const swapped = bot.spells[0];
    bot.respawn();

    expect(bot.spells[0]).not.toBe(swapped);
    expect(bot.name).toBe('Zed');
  });
});
