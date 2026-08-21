import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain, SCORE_DAMAGE, SCORE_ZONE } from '../../../src/game/ai/BotBrain';
import { SpellRole, roles } from '../../../src/game/ai/SpellRole';
import type Spell from '../../../src/game/gameObject/Spell';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeZed_R from '../../../packs/riot/spells/Zed_R';
import makeAlistar_W from '../../../packs/riot/spells/Alistar_W';
import makeNocturne_R from '../../../packs/riot/spells/Nocturne_R';
const __api = buildContentApi();
const Zed_R = makeZed_R(__api);
const Alistar_W = makeAlistar_W(__api);
const Nocturne_R = makeNocturne_R(__api);

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';

/**
 * The brain's whole contract with a spell is these members, so a stub that has
 * them is a faithful stand-in — and each stub needs its OWN class, because
 * `rolesOf` caches the mask by constructor.
 *
 * `press` is a spy so a test can drive `BotBrain.update` end to end and ask
 * which ability the bot actually pressed, rather than which one `chooseSpell`
 * returned. It reports `true`, which is what a real spell returns once it has
 * committed; `BotBrain.cast` only records the cast if it does.
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
    press = vi.fn(() => true);
    hold = vi.fn();
    release = vi.fn();
  }
  return new Stub() as unknown as Spell & { press: ReturnType<typeof vi.fn> };
};

const view = (over: Partial<TeamView> = {}): TeamView => ({
  allies: [],
  enemies: [],
  focusTarget: null,
  rally: null,
  memory: new Map<Champion, SeenEnemy>(),
  lanes: new Map<string, LaneState>(),
  laneAssignments: new Map<Champion, string>(),
  enemyTurrets: [],
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

  it('never throws the ultimate at a guess', () => {
    // `chooseGhostSpell` is the "it guessed where I went" moment, and an area
    // spell at a half-second-old position is a fair read. An ultimate is not:
    // it is the one cooldown a bot cannot afford to spend on a position that
    // may be empty, and `drive-bot-discipline.mjs` counted one being spent that
    // way in a 20-second window.
    const { bot, brain, enemy } = setup();
    const ultimate = makeSpell(SpellRole.Zone, { range: 600 });
    bot.spells = [makeSpell(0), null, null, null, ultimate] as unknown as Spell[];

    const seen = { unit: enemy, atMs: 0, pos: { x: 200, y: 0 }, vel: { x: 0, y: 0 } };
    expect(brain.chooseGhostSpell(seen, 100, { x: 200, y: 0 })).toBeNull();

    // ...and the same spell in an ordinary slot is still offered, so what the
    // skip answers to is the slot and not the role mask.
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Zone, { range: 600 })];
    expect(brain.chooseGhostSpell(seen, 100, { x: 200, y: 0 })?.slotIndex).toBe(1);
  });

  it('never presses an ultimate at nobody', () => {
    // Reported from a real match: a bot walking an empty lane pressed R every
    // cast interval. `inferRoles` hands `Buff|Shield` to every costed SELF cast
    // and `rolesOf` adds `Ultimate` from the slot, so with no target the score
    // is Buff 5 + Ultimate 6 — every target-dependent term is skipped, and the
    // two that are left are enough on their own.
    const { bot, brain } = setup();
    bot.spells = [
      makeSpell(0),
      null,
      null,
      null,
      makeSpell(SpellRole.Buff, { range: undefined }),
    ] as unknown as Spell[];
    expect(brain.chooseSpell(null, view())).toBeNull();
  });

  it('never presses a self-cast that reaches out at nobody', () => {
    // Zed R's shape — SELF, costed, `declaredRange` 500. A spell that declares
    // a range reaches OUT at something, and there is nothing out there. Same
    // axis `isRetreatCandidate` already uses to tell a real shield from a
    // self-cast engage tool.
    const { bot, brain } = setup();
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Buff, { range: 500 })];
    expect(brain.chooseSpell(null, view())).toBeNull();
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

  it('reads an undeclared range as the tier reach, never as an infinite one', () => {
    // `Flash` declares no range at all, and 27 other POINT/DIRECTION spells in
    // `packs/riot/spells/` declare none either. Reading that as
    // +Infinity made every one of them reachable from anywhere on the map, so
    // the skip below never fired for any of them.
    const { game, bot, brain } = setup(); // normal aggroRange is 420
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Damage, { range: undefined })];

    const beyond = new Champion({
      game,
      position: createVector(500, 0),
      teamId: RED,
      preset: PRESET,
    });
    expect(brain.chooseSpell(beyond, view())).toBeNull();

    // ...and still offered inside that reach, so what the skip answers to is
    // the distance and not merely the missing declaration.
    const inside = new Champion({
      game,
      position: createVector(300, 0),
      teamId: RED,
      preset: PRESET,
    });
    expect(brain.chooseSpell(inside, view())?.slotIndex).toBe(1);
  });

  it('withholds the zone bonus from a spell whose reach it had to guess', () => {
    // `Zone`'s +8 is paid for an area the spell covers. A range-less spell used
    // to collect it unconditionally, because the reach it was compared against
    // was +Infinity and `Infinity <= Infinity` is true. That is most of how
    // Flash — `Damage | Zone | Burst` by inference — outscored every real Q.
    const { brain, enemy } = setup(); // enemy 200px away, inside either reach
    brain.rng = () => 0.5; // the neutral multiplier, so raw scores come through
    const mask = roles(SpellRole.Damage, SpellRole.Zone);

    const declared = makeSpell(mask, { range: 500 });
    expect(brain.scoreSpell(declared, 1, mask, enemy, view())).toBeCloseTo(
      SCORE_DAMAGE + SCORE_ZONE,
      6
    );

    const guessed = makeSpell(mask, { range: undefined });
    expect(brain.scoreSpell(guessed, 1, mask, enemy, view())).toBeCloseTo(SCORE_DAMAGE, 6);
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

  it('will not throw a range-less spell at a point outside the tier reach either', () => {
    // An undeclared range is not an unlimited one — the same ruling `reachOf`
    // makes for `scoreSpell` and `aimFor`, at the one site the last pass did
    // not enumerate. It matters here more than anywhere: every `POINT` spell
    // without a declared range infers to `Damage | Zone`, so all 23 of them
    // plus `Flash` are ghost candidates, and the search point can sit
    // `SEARCH_MAX_DISTANCE_PX + SEARCH_MAX_LEAD_PX` = 1200px away.
    const { bot, brain, enemy } = setup('hard'); // aggroRange 480
    bot.spells = [makeSpell(0), makeSpell(SpellRole.Zone, { range: undefined })];
    const farAim = { x: 3_000, y: 0 };
    expect(brain.chooseGhostSpell(entry(0, enemy), 500, farAim)).toBeNull();
  });
});

/**
 * The retreat casts, driven through `BotBrain.update` rather than by assigning
 * `brain.posture`. The posture in each of these is produced by `decidePosture`
 * from the bot's own health, which is the whole point: `SCORE_ESCAPE` and
 * `SCORE_SUPPORT` were both written into the scorer and neither was reachable
 * in a running match, and the test that covered them set the posture by hand.
 */
describe('casting while running away', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  /**
   * `createGame`'s `createSpellContext` returns `undefined`, which makes
   * `BotBrain.cast` bail before it presses anything — so a test driving the
   * real path has to hand the brain a context it can cast with.
   */
  const casting = (difficulty: 'easy' | 'normal' | 'hard' = 'normal') => {
    const made = setup(difficulty);
    (made.game as unknown as { createSpellContext: () => unknown }).createSpellContext = () => ({
      cursorWorld: { x: 0, y: 0 },
    });
    made.brain.rng = () => 0.5; // neutral multiplier, so raw scores rank
    return made;
  };

  it('presses its escape while retreating, with nobody setting the posture', () => {
    const { bot, brain } = casting(); // normal retreats below 30% health
    const damage = makeSpell(SpellRole.Damage);
    // `range: undefined`, here and in the two below: `isRetreatCandidate` takes
    // a declared range as the mark of a spell that reaches *out* at something,
    // and a real self-cast escape or heal declares none. A stub carrying the
    // default 500 is not one of these spells.
    const getaway = makeSpell(SpellRole.Escape, { range: undefined });
    bot.spells = [makeSpell(0), damage, getaway];
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.2;

    brain.update(1_000, 16);

    expect(brain.posture).toBe('RETREAT');
    expect(getaway.press).toHaveBeenCalledTimes(1);
    expect(damage.press).not.toHaveBeenCalled();
  });

  it('will not fire a damage spell while running away', () => {
    // The other half of the ruling: a fleeing bot casts, but only what helps it
    // leave. Without the role narrowing this kit's damage spell scores 10, wins
    // its own selection and gets pressed at the enemy the bot is running from.
    const { bot, brain } = casting();
    const damage = makeSpell(SpellRole.Damage);
    bot.spells = [makeSpell(0), damage];
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.2;

    brain.update(1_000, 16);

    expect(brain.posture).toBe('RETREAT');
    expect(damage.press).not.toHaveBeenCalled();
  });

  it('presses its heal once it has arrived and settled into RECOVER', () => {
    // RECOVER is where a hurt bot spends most of its time — `decidePosture`
    // latches it there until health AND mana are back, and it cannot heal
    // without casting. `createGame` has no turrets and no fountain, so
    // `atRetreatPoint()` is true and the second tick is RECOVER.
    const { bot, brain } = casting();
    const heal = makeSpell(SpellRole.Heal, { range: undefined });
    bot.spells = [makeSpell(0), heal];
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.2;

    brain.update(1_000, 16);
    expect(brain.posture).toBe('RETREAT');
    heal.press.mockClear();

    brain.update(2_000, 16); // past normal's 900ms cast interval
    expect(brain.posture).toBe('RECOVER');
    expect(heal.press).toHaveBeenCalledTimes(1);
  });

  it('still obeys the cast interval while retreating', () => {
    const { bot, brain } = casting();
    const getaway = makeSpell(SpellRole.Escape, { range: undefined });
    bot.spells = [makeSpell(0), getaway];
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.2;

    brain.update(1_000, 16);
    brain.update(1_400, 16); // 400ms later: a think tick, but inside 900ms
    expect(getaway.press).toHaveBeenCalledTimes(1);
  });

  /**
   * The three tests in this file that use REAL spell classes, because the stubs
   * are what hid the bug they cover: every stub declares `static aiRoles`, and
   * **no spell in `packs/riot/spells/` does**. On real data `Escape`,
   * `Heal` and `Shield` come only from `inferRoles`, and it hands
   * `roles(Buff, Shield)` to every costed `SELF` cast — 72 of the 82 `SELF`
   * spells in that directory. In RETREAT that mask is the only thing the role
   * filter leaves standing, so whatever carries it is what the bot presses.
   *
   * Each case below is pinned by ONE of the two axes in `isRetreatCandidate`,
   * so neither can be dropped without a red test.
   */
  const fleeingWith = (spell: Spell, slotIndex: number) => {
    const { bot, brain } = casting(); // normal retreats below 30% health
    // Spied, not stubbed: the point is which spell the bot chooses, and letting
    // a real cast run would spawn dashes and shadows this test has no use for.
    const press = vi.spyOn(spell, 'press').mockReturnValue(true);
    const kit: Spell[] = [makeSpell(0), makeSpell(0), makeSpell(0), makeSpell(0), makeSpell(0)];
    kit[slotIndex] = spell;
    bot.spells = kit;
    bot.stats.mana.baseValue = 500;
    bot.stats.maxMana.baseValue = 500;
    bot.stats.health.baseValue = bot.stats.maxHealth.value * 0.2;

    brain.update(1_000, 16);

    expect(brain.posture).toBe('RETREAT');
    return press;
  };

  it('does not ult into its pursuer while running away — Zed R', () => {
    // `SELF`, 50 mana, `range` 500: it auto-locks the nearest enemy inside
    // 500px and dashes *behind* them. Under `RETREAT_ROLES` alone it scored
    // Shield 20 + Buff 5 + Ultimate 6 and won unopposed, so a bot below its
    // retreat threshold ulted into the champion chasing it — strictly worse
    // than the "presses nothing while fleeing" bug that ruling was fixing.
    // Caught by both axes: ultimate slot, and a declared range.
    const { bot } = casting();
    expect(fleeingWith(new Zed_R(bot as unknown as Champion), 4)).not.toHaveBeenCalled();
  });

  it('does not headbutt its pursuer while running away — Alistar W, no ultimate involved', () => {
    // The axis-2 case on its own: `SELF`, 50 mana, `range` 400, and it dashes
    // TO the nearest enemy. Not an ultimate, so only "declares a range" keeps
    // it out — a real shield or heal reaches nobody.
    const { bot } = casting();
    expect(fleeingWith(new Alistar_W(bot as unknown as Champion), 2)).not.toHaveBeenCalled();
  });

  it('does not open Paranoia while running away — Nocturne R declares no range at all', () => {
    // The axis-1 case on its own, and the reason the ultimate slot is excluded
    // rather than the range test being the whole rule: Nocturne's leap reach is
    // `leapRange`, not `range`, so `declaredRange` is `undefined` and axis 2
    // waves it through. Only the ultimate exclusion stops it.
    const { bot } = casting();
    expect(fleeingWith(new Nocturne_R(bot as unknown as Champion), 4)).not.toHaveBeenCalled();
  });
});
