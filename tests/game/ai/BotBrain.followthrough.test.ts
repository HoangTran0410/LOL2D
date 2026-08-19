/**
 * A bot has to finish what it starts.
 *
 * Two separate ways it did not, both reported from real matches:
 *
 * - **Recasts were never pressed.** `BotBrain.cast` set up a follow-through for
 *   `HOLD_RELEASE`/`TAP_OR_HOLD` and for nothing else, so the seven spells with
 *   `activation: 'RECAST'` got exactly one press. Jhin R raised the curtain and
 *   fired none of its four rounds; Ziggs W never detonated, Riven R never
 *   slashed, Renekton E never dashed back.
 *
 * - **The bot cancelled its own cast by walking.** `drive()` re-issues
 *   `navigateTo` every think tick, `navigateTo` bumps `movementRevision`, and
 *   `CancelPolicy` reads that bump as `'MOVE'` — which the default `SpellForm.HELD`
 *   cancels on. The think interval is 250ms, so every spell with a cast time at
 *   or above it died mid-cast: Caitlyn R (1000ms), Ezreal R (700), Darius Q
 *   (550), Sett W (450), Morgana R and Caitlyn Q (350), Ziggs R (340), Xin Zhao R
 *   and Jhin W (300), Darius E (250).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain } from '../../../src/game/ai/BotBrain';
import { SpellRole } from '../../../src/game/ai/SpellRole';
import type Spell from '../../../src/game/gameObject/Spell';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';
const FRAME_MS = 1000 / 60;

type SpellStub = Spell & { press: ReturnType<typeof vi.fn> };

/**
 * A recast ability, shaped the way `Jhin_R` is: one press opens it, `recasts`
 * further presses are the payload, and the runtime holds it `ACTIVE` in between.
 * Its own class, because `rolesOf` caches the role mask by constructor.
 */
const makeRecastSpell = (recasts: number, recastDelayMs: number): SpellStub => {
  class Stub {
    static aiRoles = SpellRole.Damage;
    effectiveManaCost = 10;
    manaCost = 10;
    declaredRange: number | undefined = 500;
    state = 'READY';
    /** A real spell refuses a fresh cast while its own window is open. */
    get isCastableNow() {
      return this.state === 'READY';
    }
    castSpec = {
      activation: 'RECAST' as const,
      targeting: 'DIRECTION' as const,
      active: { recasts, recastDelayMs },
    };
    press = vi.fn(function (this: Stub) {
      this.state = 'ACTIVE';
      return true;
    });
    hold = vi.fn();
    release = vi.fn();
  }
  return new Stub() as unknown as SpellStub;
};

/** An ability frozen mid-cast, with the default interrupt form (move cancels). */
const makeCastingSpell = (): SpellStub => {
  class Stub {
    static aiRoles = SpellRole.Damage;
    isCastableNow = false;
    effectiveManaCost = 10;
    manaCost = 10;
    declaredRange: number | undefined = 500;
    state = 'CASTING';
    castSpec = { activation: 'PRESS' as const, targeting: 'DIRECTION' as const, castTimeMs: 500 };
    press = vi.fn(() => true);
    hold = vi.fn();
    release = vi.fn();
  }
  return new Stub() as unknown as SpellStub;
};

const setup = () => {
  const game: TestGame = createGame();
  const bot = new AIChampion({
    game,
    position: createVector(0, 0),
    teamId: BLUE,
    preset: PRESET,
    difficulty: 'normal',
  });
  const enemy = new Champion({ game, position: createVector(200, 0), teamId: RED, preset: PRESET });
  game.setPlayer(bot);
  indexObjects(game, [bot, enemy]);
  bot.stats.mana.baseValue = 500;
  bot.stats.maxMana.baseValue = 500;
  // The fixture answers `undefined`, which makes `contextFor` refuse and `cast`
  // return before it presses anything. Same override the spells suite uses.
  (game as unknown as { createSpellContext: () => unknown }).createSpellContext = () => ({
    cursorWorld: { x: 0, y: 0 },
  });
  const brain = new BotBrain(bot);
  brain.rng = () => 0.5;
  return { game, bot, enemy, brain };
};

/** Runs the brain for `ms` of game time, one frame at a time, as the game does. */
const run = (brain: BotBrain, ms: number, from = 1_000): number => {
  let now = from;
  for (const end = from + ms; now < end; now += FRAME_MS) brain.update(now, FRAME_MS);
  return now;
};

describe('a recast ability gets its recasts', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('presses again once per recast, not once in total', () => {
    const { bot, brain } = setup();
    const spell = makeRecastSpell(4, 500);
    bot.spells = [null, spell] as unknown as Spell[];

    // 4 recasts, 500ms apart, is 2s of follow-through. Give it 4s.
    run(brain, 4_000);

    expect(spell.press).toHaveBeenCalledTimes(5);
  });

  it('spaces them by recastDelayMs rather than firing them on one frame', () => {
    const { bot, brain } = setup();
    const spell = makeRecastSpell(4, 500);
    bot.spells = [null, spell] as unknown as Spell[];

    // One opening press, then only the first recast is due 600ms in.
    run(brain, 600);

    expect(spell.press).toHaveBeenCalledTimes(2);
  });

  it('drops the follow-through when the runtime closes the window', () => {
    const { bot, brain } = setup();
    const spell = makeRecastSpell(4, 500);
    bot.spells = [null, spell] as unknown as Spell[];

    const now = run(brain, 600);
    expect(spell.press).toHaveBeenCalledTimes(2);

    // The stage lapsed on its own terms — no further press may be sent.
    (spell as unknown as { state: string }).state = 'COOLDOWN';
    run(brain, 3_000, now);

    expect(spell.press).toHaveBeenCalledTimes(2);
  });
});

describe('a bot does not walk out of its own cast', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('issues no move order while a cast that moving would cancel is in flight', () => {
    const { bot, brain } = setup();
    bot._autoCast = false;
    bot.spells = [null, makeCastingSpell()] as unknown as Spell[];
    const navigateTo = vi.spyOn(bot, 'navigateTo');

    run(brain, 2_000);

    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('still drives normally once nothing is mid-cast', () => {
    const { bot, brain } = setup();
    bot._autoCast = false;
    const spell = makeCastingSpell();
    (spell as unknown as { state: string }).state = 'READY';
    bot.spells = [null, spell] as unknown as Spell[];
    const navigateTo = vi.spyOn(bot, 'navigateTo');

    run(brain, 2_000);

    expect(navigateTo).toHaveBeenCalled();
  });
});
