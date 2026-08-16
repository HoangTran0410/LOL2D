import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchDirector from '../../../src/game/MatchDirector';
import { DEFAULT_CHAMPION_LOADOUT } from '../../../src/game/config/PregameConfig';
import type { ChampionLoadout } from '../../../src/game/config/PregameConfig';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
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
    const swapped = bot.spells.map(spell => spell.name);
    // Not "the instances are new": `applyPreset` keeps the instance of a slot
    // whose spell class is unchanged, so re-applying the same loadout hands
    // back the same objects on purpose. Wrecking the kit first is what tells a
    // respawn that reapplied the loadout from one that skipped it entirely.
    bot.replaceSpells([]);
    bot.name = 'not-zed';
    bot.respawn();

    expect(bot.spells.map(spell => spell.name)).toEqual(swapped);
    expect(bot.name).toBe('Zed');
  });
});

/**
 * The one thing a `Champion` cannot be asked. `getChampionPresetFromLoadout` is
 * one-way — `championName: 'random'` has already collapsed into one particular
 * champion by the time a unit exists — so a roster tab that opened its editor
 * on "whatever this unit looks like" would be showing a *different* match
 * setting from the one the player chose. Hence the director remembering it.
 */
describe('MatchDirector.loadoutOf', () => {
  it('hands back what a bot was added with', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    const bot = director.addBot(AHRI)!;

    expect(director.loadoutOf(bot)).toEqual(AHRI);
  });

  it('follows a champion swap rather than reporting what the unit was added with', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(AHRI)!;
    game.objectManager.update();

    director.applyLoadout(bot, ZED);

    expect(director.loadoutOf(bot)).toEqual(ZED);
  });

  it('remembers the player, who is never added and never a bot', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    director.applyLoadout(player, ZED);

    expect(director.loadoutOf(player)).toEqual(ZED);
  });

  it('takes a seed for a unit the match built before the director existed', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);

    // What `Game`'s constructor does: the player and the configured bots are
    // built ~60 lines before `new MatchDirector(this)` runs.
    director.seedLoadout(player, AHRI);

    expect(director.loadoutOf(player)).toEqual(AHRI);
  });

  it('lets a swap overwrite a seed, not the other way round', () => {
    const { context: ctx, player } = context();
    const director = new MatchDirector(ctx);
    director.seedLoadout(player, AHRI);

    director.applyLoadout(player, ZED);

    expect(director.loadoutOf(player)).toEqual(ZED);
  });

  it('answers for a unit nobody recorded, rather than handing back undefined', () => {
    const { context: ctx, game } = context();
    const director = new MatchDirector(ctx);
    // A unit that reached the world without going through `addBot` or a seed —
    // what a test bench, or any future scenario loader, looks like.
    const stranger = new Champion({ game, position: createVector(10, 10) });

    const loadout = director.loadoutOf(stranger);

    expect(loadout).toBeDefined();
    expect(loadout).toEqual(DEFAULT_CHAMPION_LOADOUT);
  });

  it('keeps each unit on its own loadout', () => {
    const { context: ctx, game, player } = context();
    const director = new MatchDirector(ctx);
    const bot = director.addBot(AHRI)!;
    game.objectManager.update();

    director.applyLoadout(player, ZED);

    expect(director.loadoutOf(bot)).toEqual(AHRI);
    expect(director.loadoutOf(player)).toEqual(ZED);
  });
});

/**
 * The derived rules, not the editable percentages — `getRules()` is the other
 * view. The loadout editor's description panel quotes the cooldown and mana
 * cost this match will actually charge, and takes exactly this shape.
 */
describe('MatchDirector.matchRules', () => {
  it('is the live object every spell already holds, not a copy of it', () => {
    const { context: ctx } = context();
    const director = new MatchDirector(ctx);

    director.setRules({ cooldownReductionPercent: 40, manaFree: true });

    expect(director.matchRules).toBe(ctx.matchRules);
    expect(director.matchRules.cooldownMultiplier).toBeCloseTo(0.6);
    expect(director.matchRules.manaFree).toBe(true);
  });
});
