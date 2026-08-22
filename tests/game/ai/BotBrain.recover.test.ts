import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import Turret from '../../../src/game/gameObject/structures/Turret';
import { RECALL_CLEAR_PX, RECALL_SAFE_MS } from '../../../src/game/ai/BotBrain';
import TargetResolver from '../../../src/game/spell/targeting/TargetResolver';
import type Spell from '../../../src/game/gameObject/Spell';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { RECALL_CHANNEL_MS } from '../../../src/game/gameObject/coreSpells/Recall';
import makeRecall from '../../../src/game/gameObject/coreSpells/Recall';
const __api = buildContentApi();
const Recall = makeRecall(__api);

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = TeamId.BLUE;

const HOME = { x: 500, y: 500 };
const TURRET = { x: 1_500, y: 1_500 };
const FOUNTAIN_RADIUS = 200;

/**
 * A hurt bot, its team's fountain, and the turret it retreats to. `_autoCast`
 * off throughout: the kit is empty, and the question here is only the trip home.
 */
const wounded = (game: TestGame, x: number, y: number) => {
  const bot = new AIChampion({
    game,
    position: createVector(x, y),
    teamId: BLUE,
    preset: PRESET,
  });
  // No longer built by the class itself — `Champion.recall` is nullable now
  // that a map without a fountain can leave it unset. This is the same
  // one-line attachment `preset.ts`'s `attachRecall` does for a real match.
  bot.recall = new Recall(bot);
  bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.15;
  bot._autoCast = false;

  const fountain = new Fountain({
    game,
    preset: { name: 'Bệ Đá Cổ', x: HOME.x, y: HOME.y, r: FOUNTAIN_RADIUS, teamId: BLUE },
  });
  const turret = new Turret({ game, position: createVector(TURRET.x, TURRET.y), teamId: BLUE });

  game.setPlayer(bot);
  indexObjects(game, [bot, turret]);
  const host = game as unknown as {
    turrets: Turret[];
    fountains: Fountain[];
    createSpellContext: unknown;
  };
  host.turrets = [turret];
  host.fountains = [fountain];
  // `createGame` answers `undefined`, which every cast path reads as "this
  // spell cannot be aimed". This is `Game.createSpellContext`'s own body, minus
  // the candidate query a SELF cast never reaches.
  host.createSpellContext = (
    spell: Spell,
    caster: { teamId?: unknown; position: { x: number; y: number } },
    cursorWorld: { x: number; y: number }
  ) => {
    const resolved = TargetResolver.resolve(spell.castSpec.targeting, {
      spellId: spell.id,
      activationId: 'test',
      startedAtMs: 0,
      caster,
      casterTeamId: caster.teamId,
      origin: caster.position,
      cursorWorld,
      ...spell.targetingRequest,
    });
    return resolved.ok ? resolved.context : undefined;
  };
  return { bot, fountain, turret, brain: bot.brain };
};

describe('going home', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('does not start the channel while it is still walking home', () => {
    // Recall is `SpellForm.HELD`: a bot that opened it mid-retreat would cancel
    // it on its own next step, every tick, for the whole walk.
    const { bot, brain } = wounded(createGame(), TURRET.x + 900, TURRET.y);

    brain.update(1_000, 16);

    expect(brain.posture).toBe('RETREAT');
    expect(bot.recall.state).toBe('READY');
  });

  it('channels once it has settled at its turret', () => {
    const { bot, brain } = wounded(createGame(), TURRET.x, TURRET.y + 40);

    // Two ticks: `decidePosture` latches `recovering` and answers RETREAT on
    // the tick it does so, whatever the bot is standing next to.
    brain.update(1_000, 16);
    brain.update(2_000, 16);

    expect(brain.posture).toBe('RECOVER');
    expect(bot.recall.state).toBe('CHANNELING');
  });

  it('arrives on its own platform when the channel runs out', () => {
    const { bot, brain } = wounded(createGame(), TURRET.x, TURRET.y + 40);
    brain.update(1_000, 16);
    brain.update(2_000, 16);

    // Run the channel out. Nothing moves the bot and nothing hits it, so the
    // only thing that can end this is the duration.
    for (let elapsed = 0; elapsed <= RECALL_CHANNEL_MS; elapsed += 16) bot.recall.update();

    expect(bot.position.x).toBe(HOME.x);
    expect(bot.position.y).toBe(HOME.y);
  });

  it('stays put on the platform instead of walking back to the turret', () => {
    // `atRetreatPoint` used to mean "near the nearest friendly turret" only, so
    // a bot that had just recalled read as not-yet-arrived and set off again —
    // out of the one place on the map that actually restores it.
    const { bot, brain } = wounded(createGame(), HOME.x, HOME.y);

    brain.update(1_000, 16);
    brain.update(2_000, 16);

    expect(brain.posture).toBe('RECOVER');
    expect(bot.destination.x).toBe(HOME.x);
    expect(bot.destination.y).toBe(HOME.y);
  });

  it('does not channel a second trip while standing on the platform', () => {
    const { bot, brain } = wounded(createGame(), HOME.x, HOME.y);

    brain.update(1_000, 16);
    brain.update(2_000, 16);

    expect(bot.recall.state).toBe('READY');
  });

  it('drops the channel the moment it is healthy enough to play again', () => {
    const { bot, brain } = wounded(createGame(), TURRET.x, TURRET.y + 40);
    brain.update(1_000, 16);
    brain.update(2_000, 16);
    expect(bot.recall.state).toBe('CHANNELING');

    bot.stats.health.baseValue = bot.stats.maxHealth.value;
    bot.stats.mana.baseValue = bot.stats.maxMana.value;
    brain.update(3_000, 16);

    expect(brain.posture).not.toBe('RECOVER');
    expect(bot.recall.state).not.toBe('CHANNELING');
  });

  it('leaves the trip alone for a bot the player has parked', () => {
    const { bot, brain } = wounded(createGame(), TURRET.x, TURRET.y + 40);
    bot._autoMove = false;

    brain.update(1_000, 16);
    brain.update(2_000, 16);

    expect(bot.recall.state).toBe('READY');
  });
});

describe('going home is only worth it when nothing is chasing', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  /** The wounded bot at its turret, plus a hostile champion `away` px from it. */
  const hunted = (away: number) => {
    const game = createGame();
    const made = wounded(game, TURRET.x, TURRET.y + 40);
    const chaser = new Champion({
      game,
      position: createVector(TURRET.x + away, TURRET.y + 40),
      teamId: TeamId.RED,
      preset: PRESET,
    });
    indexObjects(game, [made.bot, made.turret, chaser]);
    return { ...made, game, chaser };
  };

  it('does not stand still to channel with an enemy champion on top of it', () => {
    // Reported from a real match: the bot ran to its turret with an enemy bot
    // right behind it, stopped, and opened a four-second channel.
    const { bot, brain } = hunted(RECALL_CLEAR_PX - 100);

    brain.update(10_000, 16);
    brain.update(11_000, 16);

    expect(bot.recall.state).toBe('READY');
  });

  it('walks on to the platform rather than holding at the turret while hunted', () => {
    const { bot, brain } = hunted(RECALL_CLEAR_PX - 100);

    brain.update(10_000, 16);
    brain.update(11_000, 16);

    expect(bot.destination.x).toBe(HOME.x);
    expect(bot.destination.y).toBe(HOME.y);
  });

  it('channels once the chaser is far enough away', () => {
    const { bot, brain } = hunted(RECALL_CLEAR_PX + 400);

    brain.update(10_000, 16);
    brain.update(11_000, 16);

    expect(bot.recall.state).toBe('CHANNELING');
  });

  it('waits out the seconds after a hit before standing still', () => {
    const game = createGame();
    const { bot, brain } = wounded(game, TURRET.x, TURRET.y + 40);
    game.matchTimeMs = 10_000;
    bot.takeDamage(1);

    brain.update(10_000, 16);
    brain.update(10_000 + RECALL_SAFE_MS - 500, 16);
    expect(bot.recall.state).toBe('READY');

    brain.update(10_000 + RECALL_SAFE_MS + 500, 16);
    expect(bot.recall.state).toBe('CHANNELING');
  });

  it('drops a running channel when an enemy turns up', () => {
    // The other half of the report: an enemy appearing mid-channel is not a
    // move, a stun or a hit, so nothing in the interrupt table can see it.
    const game = createGame();
    const { bot, brain, turret } = wounded(game, TURRET.x, TURRET.y + 40);
    brain.update(10_000, 16);
    brain.update(11_000, 16);
    expect(bot.recall.state).toBe('CHANNELING');

    const chaser = new Champion({
      game,
      position: createVector(TURRET.x + 200, TURRET.y + 40),
      teamId: TeamId.RED,
      preset: PRESET,
    });
    indexObjects(game, [bot, turret, chaser]);
    brain.update(12_000, 16);

    expect(bot.recall.state).not.toBe('CHANNELING');
  });
});
