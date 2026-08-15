import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIChampion, {
  type ChampionPresetFactory,
} from '../../../src/game/gameObject/attackableUnits/AIChampion';
import {
  DEFAULT_CHAMPION_ATTACK,
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import type { AssetKey } from '../../../src/managers/AssetManager';
import { createGame, stubGameGlobals } from '../fixtures';

class RedSpell extends Spell {
  name = 'Red';
  targetingMode = 'SELF' as const;
  coolDown = 1000;
}
class BlueSpell extends Spell {
  name = 'Blue';
  targetingMode = 'SELF' as const;
  coolDown = 2000;
}

const RED: ChampionPresetData = {
  name: 'Red',
  spells: [RedSpell],
  attack: { damage: 11, attacksPerSecond: 1.1, range: 111 },
};
const BLUE: ChampionPresetData = {
  name: 'Blue',
  spells: [BlueSpell],
  attack: { damage: 22, attacksPerSecond: 2.2, range: 222 },
};

/**
 * `ChampionPresetFactory` declares an `avatar`, but these fixtures deliberately
 * have none: an avatar means an `AssetManager.get` on a key the manifest does
 * not carry, and this suite is about the name, the kit and the attack stats.
 */
const rollsTo =
  (preset: ChampionPresetData): ChampionPresetFactory =>
  () =>
    preset as ChampionPresetData & { avatar: AssetKey };

const makeBot = (presetFactory?: ChampionPresetFactory) => {
  const game = createGame();
  const bot = new AIChampion({ game, position: createVector(0, 0), preset: RED, presetFactory });
  game.setPlayer(bot);
  return bot;
};

describe('AIChampion.respawn with a new preset', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('restores the whole champion, not just its avatar and spells', () => {
    const bot = makeBot(rollsTo(BLUE));

    bot.respawn();

    expect(bot.spells.map(s => s.name)).toEqual(['Blue']);
    // The bug: these three and the name used to keep Red's values forever.
    expect(bot.name).toBe('Blue');
    expect(bot.stats.attackDamage.baseValue).toBe(22);
    expect(bot.stats.attackSpeed.baseValue).toBe(2.2);
    expect(bot.stats.attackRange.baseValue).toBe(222);
  });

  it('keeps the current champion when respawn rolls are switched off', () => {
    const bot = makeBot(rollsTo(BLUE));

    bot.setRespawnRollsNewPreset(false);
    bot.respawn();

    expect(bot.name).toBe('Red');
    expect(bot.spells.map(s => s.name)).toEqual(['Red']);
    expect(bot.stats.attackDamage.baseValue).toBe(11);
  });

  it('rolls from whatever setPresetFactory was last handed', () => {
    const bot = makeBot(rollsTo(BLUE));

    bot.setPresetFactory(rollsTo(RED));
    bot.respawn();

    expect(bot.name).toBe('Red');
    expect(bot.spells.map(s => s.name)).toEqual(['Red']);
  });

  it("still refills health, which is super.respawn()'s job", () => {
    const bot = makeBot(rollsTo(RED));
    bot.stats.health.baseValue = 1;

    bot.respawn();

    expect(bot.stats.health.baseValue).toBe(bot.stats.maxHealth.value);
    expect(DEFAULT_CHAMPION_ATTACK.damage).toBeGreaterThan(0);
  });
});
