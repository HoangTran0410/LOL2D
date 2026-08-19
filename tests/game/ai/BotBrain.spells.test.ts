import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain } from '../../../src/game/ai/BotBrain';
import { SpellRole, roles } from '../../../src/game/ai/SpellRole';
import type Spell from '../../../src/game/gameObject/Spell';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';

/**
 * The brain's whole contract with a spell is these six members, so a stub that
 * has them is a faithful stand-in — and each stub needs its OWN class, because
 * `rolesOf` caches the mask by constructor.
 */
const makeSpell = (
  aiRoles: number,
  over: Partial<{ castable: boolean; cost: number; range: number | undefined }> = {}
) => {
  class Stub {
    static aiRoles = aiRoles;
    isCastableNow = over.castable ?? true;
    effectiveManaCost = over.cost ?? 10;
    manaCost = over.cost ?? 10;
    declaredRange: number | undefined = 'range' in over ? over.range : 500;
    // No `range` here: `CastSpec` genuinely has none. Reach comes from
    // `declaredRange`, which is what `scoreSpell` reads.
    castSpec = { targeting: 'DIRECTION' as const };
  }
  return new Stub() as unknown as Spell;
};

const view = (over: Partial<TeamView> = {}): TeamView => ({
  allies: [],
  enemies: [],
  focusTarget: null,
  rally: null,
  memory: new Map<Champion, SeenEnemy>(),
  ...over,
});

const setup = (difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
  const game: TestGame = createGame();
  const bot = new AIChampion({
    game,
    position: createVector(0, 0),
    teamId: BLUE,
    preset: PRESET,
    difficulty,
  });
  const enemy = new Champion({
    game,
    position: createVector(200, 0),
    teamId: RED,
    preset: PRESET,
  });
  game.setPlayer(bot);
  indexObjects(game, [bot, enemy]);
  const brain = new BotBrain(bot);
  // rng 0 is the LOW end of the symmetric multiplier, not the neutral point:
  // it gives (1 - noise), i.e. 0.55 at normal. Deliberate and harmless — one
  // decision applies one constant scalar to every candidate, so ordering and
  // sign are preserved — but the scores below are not the raw ones. Use 0.5 if
  // you ever need the raw value.
  brain.rng = () => 0;
  return { game, bot, enemy, brain };
};

describe('mana budget', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('holds back a reserve for the ultimate', () => {
    const { bot, brain } = setup('normal'); // manaReservePct 0.25
    bot.stats.mana.baseValue = 200;
    bot.stats.maxMana.baseValue = 500;
    const ultimate = makeSpell(SpellRole.Damage, { cost: 60 });
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage), makeSpell(0), makeSpell(0), ultimate];

    // reserve = 500 * 0.25 = 125. budget = 200 - 125 = 75, by hand.
    expect(
      brain.withinManaBudget(makeSpell(SpellRole.Damage, { cost: 70 }), SpellRole.Damage)
    ).toBe(true);
    expect(
      brain.withinManaBudget(makeSpell(SpellRole.Damage, { cost: 80 }), SpellRole.Damage)
    ).toBe(false);
  });

  it('never budgets the ultimate against itself', () => {
    const { bot, brain } = setup('normal');
    bot.stats.mana.baseValue = 130;
    bot.stats.maxMana.baseValue = 500;
    const ultimate = makeSpell(SpellRole.Damage, { cost: 120 });
    bot.spells = [makeSpell(0), makeSpell(0), makeSpell(0), makeSpell(0), ultimate];

    expect(brain.withinManaBudget(ultimate, roles(SpellRole.Damage, SpellRole.Ultimate))).toBe(
      true
    );
  });

  it('stops reserving while the ultimate is on cooldown — that is liquid mana', () => {
    const { bot, brain } = setup('normal');
    bot.stats.mana.baseValue = 200;
    bot.stats.maxMana.baseValue = 500;
    const ultimate = makeSpell(SpellRole.Damage, { cost: 60, castable: false });
    bot.spells = [makeSpell(0), makeSpell(0), makeSpell(0), makeSpell(0), ultimate];

    expect(
      brain.withinManaBudget(makeSpell(SpellRole.Damage, { cost: 190 }), SpellRole.Damage)
    ).toBe(true);
  });

  it('reserves nothing at easy, which has no reserve at all', () => {
    const { bot, brain } = setup('easy'); // manaReservePct 0
    bot.stats.mana.baseValue = 100;
    bot.stats.maxMana.baseValue = 500;
    bot.spells = [makeSpell(0), makeSpell(0), makeSpell(0), makeSpell(0), makeSpell(0)];
    expect(
      brain.withinManaBudget(makeSpell(SpellRole.Damage, { cost: 100 }), SpellRole.Damage)
    ).toBe(true);
  });
});

describe('spell choice', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('never offers the basic attack slot', () => {
    const { bot, brain, enemy } = setup();
    bot.spells = [makeSpell(SpellRole.Damage)];
    expect(brain.chooseSpell(enemy, view())).toBeNull();
  });

  it('skips anything not castable right now', () => {
    const { bot, brain, enemy } = setup();
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage, { castable: false })];
    expect(brain.chooseSpell(enemy, view())).toBeNull();
  });

  it('prefers a heal when hurt and refuses it at full health', () => {
    const { bot, brain, enemy } = setup();
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage), makeSpell(SpellRole.Heal)];

    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(1); // full health: damage
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.2;
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(2); // hurt: heal
  });

  it('prefers an escape while retreating', () => {
    const { bot, brain, enemy } = setup();
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage), makeSpell(SpellRole.Escape)];
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(1);

    brain.posture = 'RETREAT';
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(2);
  });

  it('skips a spell whose range cannot reach, unless it closes the gap itself', () => {
    const { bot, brain, enemy } = setup(); // enemy is 200px away
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage, { range: 100 })];
    expect(brain.chooseSpell(enemy, view())).toBeNull();

    bot.spells = [makeSpell(0), makeSpell(roles(SpellRole.Damage, SpellRole.Dash), { range: 100 })];
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(1);
  });

  it('lets a SELF spell be chosen with no target at all', () => {
    const { bot, brain } = setup();
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Buff, { range: undefined })];
    expect(brain.chooseSpell(null, view())?.slotIndex).toBe(1);
  });

  it('does not fire a poke skillshot at nobody', () => {
    // `distance` is +Infinity with no target, which used to satisfy the reach
    // test on its own, so a Poke-role spell scored 6 with nobody to shoot at —
    // `inferRoles` tags every DIRECTION/POINT spell of range >= 400 as Poke, so
    // a roaming bot would fire skillshots at `FALLBACK_AIM_PX` ahead of itself,
    // on cooldown. Every other target-dependent term already carries `&& target`.
    const { bot, brain } = setup();
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Poke)];
    expect(brain.chooseSpell(null, view())).toBeNull();
  });

  it('turns into a different bot when the noise is turned up', () => {
    const { bot, brain, enemy } = setup('easy');
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage), makeSpell(SpellRole.Buff)];

    // Mid roll (0.5) is the neutral multiplier 1.0 at every tier, so the raw
    // ranking wins: Damage 10 beats Buff 5.
    brain.rng = () => 0.5;
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(1);

    // easy noise 0.9, multiplier = 1 + (rng*2 - 1)*0.9, i.e. range [0.1, 1.9].
    // First roll 0 -> Damage 10 * 0.1 = 1. Second roll 1 -> Buff 5 * 1.9 = 9.5.
    // 9.5 > 1, so the easy bot buffs when it should have hit. Arithmetic by hand.
    let call = 0;
    brain.rng = () => (call++ === 0 ? 0 : 1);
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(2);
  });

  it('stays on the good choice at hard, given the identical rolls', () => {
    // The counterpart that makes the previous test mean something. hard noise
    // 0.2 -> range [0.8, 1.2]. Damage 10 * 0.8 = 8; Buff 5 * 1.2 = 6. 8 > 6, so
    // the same rolls that flip an easy bot do not flip a hard one. Without this,
    // the noise test above passes on a hard-coded constant.
    const { bot, brain, enemy } = setup('hard');
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage), makeSpell(SpellRole.Buff)];

    let call = 0;
    brain.rng = () => (call++ === 0 ? 0 : 1);
    expect(brain.chooseSpell(enemy, view())?.slotIndex).toBe(1);
  });
});

describe('ghost cast', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const entry = (atMs: number, unit: Champion): SeenEnemy => ({
    unit,
    atMs,
    pos: { x: 300, y: 0 },
    vel: { x: 0, y: 0 },
  });
  // Matches `entry().pos` — the natural aim point for a spot the bot just lost
  // sight of, well inside a 500-range spell's reach from the bot at (0, 0).
  const AIM = { x: 300, y: 0 };

  it('throws an area spell at a spot it just lost sight of', () => {
    const { bot, brain, enemy } = setup('hard'); // ghostCastWindowMs 900
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Zone)];
    expect(brain.chooseGhostSpell(entry(0, enemy), 500, AIM)?.slotIndex).toBe(1);
  });

  it('will not throw a spell that is not an area or a poke', () => {
    const { bot, brain, enemy } = setup('hard');
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Heal)];
    expect(brain.chooseGhostSpell(entry(0, enemy), 500, AIM)).toBeNull();
  });

  it('will not throw once the window has closed', () => {
    const { bot, brain, enemy } = setup('hard');
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Zone)];
    expect(brain.chooseGhostSpell(entry(0, enemy), 901, AIM)).toBeNull();
  });

  it('never throws at easy, whose window is zero', () => {
    const { bot, brain, enemy } = setup('easy');
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Zone)];
    expect(brain.chooseGhostSpell(entry(0, enemy), 0, AIM)).toBeNull();
  });

  it("will not throw at a point outside the spell's own reach", () => {
    // Without this bound, a bot throws a 300-range zone at a point 2000px
    // away and still pays the mana for it — the same reach discipline
    // `scoreSpell` applies, just never wired into the ghost path.
    const { bot, brain, enemy } = setup('hard'); // ghostCastWindowMs 900
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Zone)]; // declaredRange 500
    const farAim = { x: 3_000, y: 0 };
    expect(brain.chooseGhostSpell(entry(0, enemy), 500, farAim)).toBeNull();
  });
});
