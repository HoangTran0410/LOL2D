/**
 * Master Yi's kit, at the three places where a wrong answer would be invisible
 * on screen: how the flurry spreads its blades, what Meditate actually buys for
 * the channel, and whether Wuju Style's on-hit bonus stops when it should.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import EventType from '../../../src/game/enums/EventType';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Untargetable from '../../../src/game/gameObject/buffs/Untargetable';
import MasterYi_Q, {
  EXTRA_STRIKE_DAMAGE,
  FIRST_STRIKE_DAMAGE,
  MAX_STRIKES,
  MasterYi_Q_Object,
  SEARCH_RADIUS,
  STRIKE_INTERVAL_MS,
  VANISH_MS,
} from '../../../src/game/gameObject/spells/MasterYi_Q';
import MasterYi_W, {
  HEAL_PER_TICK,
  SHIELD_AMOUNT,
} from '../../../src/game/gameObject/spells/MasterYi_W';
import MasterYi_E, {
  BONUS_TRUE_DAMAGE,
  DURATION_MS as WUJU_DURATION_MS,
} from '../../../src/game/gameObject/spells/MasterYi_E';
import MasterYi_R from '../../../src/game/gameObject/spells/MasterYi_R';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { installSketchMathGlobals, installSpellObjectGlobals } from '../spell/fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  // The richer TestVector (limit/sub/fromAngle) and the maths helpers the real
  // spell code reaches for; these must land after stubGameGlobals to win.
  installSpellObjectGlobals();
  installSketchMathGlobals();
  game = createGame();
  playerSet = false;
});
afterEach(() => vi.unstubAllGlobals());

let playerSet = false;

const unit = (teamId: string, x: number, y = 0): Champion => {
  const champion = new Champion({ game, teamId });
  champion.position.set(x, y);
  champion.destination.set(x, y);
  champion.stats.mana.baseValue = 500;
  // `isAllied` — which the display box reads — asks the game who the player is.
  if (!playerSet) {
    game.setPlayer(champion);
    playerSet = true;
  }
  return champion;
};

const context = (caster: AttackableUnit, cursorX = 0, cursorY = 0): CastContext =>
  Object.freeze({
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    origin: { x: caster.position.x, y: caster.position.y },
    cursorWorld: { x: cursorX, y: cursorY },
    direction: { x: 1, y: 0 },
  });

/** Runs the world's clock forward for one object, `deltaTime` at a time. */
const advance = (object: { update(): void }, ms: number): void => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) object.update();
};

const flurryOf = (): MasterYi_Q_Object =>
  [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].find(
    (object): object is MasterYi_Q_Object => object instanceof MasterYi_Q_Object
  )!;

describe('Master Yi Q — Alpha Strike', () => {
  it('cuts each body once, the first for full damage and the rest for less', () => {
    const yi = unit('yi', 0);
    const near = unit('creep', 120);
    const far = unit('creep', 240);
    indexObjects(game, [yi, near, far]);
    const spell = new MasterYi_Q(yi);

    expect(spell.press(context(yi, 120))).toBe(true);
    const flurry = flurryOf();
    const nearBefore = near.stats.health.value;
    const farBefore = far.stats.health.value;

    advance(flurry, VANISH_MS + MAX_STRIKES * STRIKE_INTERVAL_MS + 32);

    // Nearest the cursor is struck first and hardest; the pass then spreads.
    expect(nearBefore - near.stats.health.value).toBe(FIRST_STRIKE_DAMAGE);
    expect(farBefore - far.stats.health.value).toBe(EXTRA_STRIKE_DAMAGE);
    // Two bodies, two blades — the flurry never doubles back onto one of them.
    expect(flurry.struck).toBe(2);
  });

  it('visits at most MAX_STRIKES bodies however many are in range', () => {
    const yi = unit('yi', 0);
    const crowd = [60, 90, 120, 150, 180, 210].map(x => unit('creep', x));
    indexObjects(game, [yi, ...crowd]);
    const spell = new MasterYi_Q(yi);

    expect(spell.press(context(yi, 60))).toBe(true);
    expect(flurryOf().victims).toHaveLength(MAX_STRIKES);
  });

  it('refuses to cast with nothing inside its search radius', () => {
    const yi = unit('yi', 0);
    const away = unit('creep', SEARCH_RADIUS + 400);
    indexObjects(game, [yi, away]);
    const spell = new MasterYi_Q(yi);

    expect(spell.press(context(yi, SEARCH_RADIUS + 400))).toBe(false);
  });

  it('makes him untargetable for the flurry and solid again when it ends', () => {
    const yi = unit('yi', 0);
    const victim = unit('creep', 120);
    indexObjects(game, [yi, victim]);
    const spell = new MasterYi_Q(yi);
    spell.press(context(yi, 120));

    const vanish = yi.buffs.find((buff): buff is Untargetable => buff instanceof Untargetable)!;
    expect(vanish.toRemove).toBe(false);

    advance(flurryOf(), VANISH_MS + STRIKE_INTERVAL_MS + 32);
    expect(vanish.toRemove).toBe(true);
  });
});

describe('Master Yi W — Meditate', () => {
  it('heals on every channel tick and puts a shield up for the sit', () => {
    const yi = unit('yi', 0);
    indexObjects(game, [yi]);
    yi.stats.health.baseValue = 40;
    const spell = new MasterYi_W(yi);

    expect(spell.press(context(yi))).toBe(true);

    const shield = yi.buffs.find((buff): buff is Shield => buff instanceof Shield)!;
    expect(shield.amount).toBe(SHIELD_AMOUNT);

    const before = yi.stats.health.value;
    spell.onChannelTick();
    expect(yi.stats.health.value - before).toBe(HEAL_PER_TICK);
  });
});

describe('Master Yi E — Wuju Style', () => {
  it('adds its bonus to a landed basic attack, and stops when the style runs out', () => {
    const yi = unit('yi', 0);
    const victim = unit('creep', 60);
    indexObjects(game, [yi, victim]);
    const spell = new MasterYi_E(yi);

    expect(spell.press(context(yi))).toBe(true);

    const landAnAttack = () =>
      game.eventManager.emit(EventType.ON_ATTACK_HIT, {
        attacker: yi,
        victim,
        damage: 10,
        ranged: false,
      });

    let before = victim.stats.health.value;
    landAnAttack();
    expect(before - victim.stats.health.value).toBe(BONUS_TRUE_DAMAGE);

    // The style is a timer, not a permanent passive.
    advance(spell, WUJU_DURATION_MS + 64);
    before = victim.stats.health.value;
    landAnAttack();
    expect(before - victim.stats.health.value).toBe(0);
  });
});

describe('Master Yi R — Highlander', () => {
  it('sheds the slow he was in and every slow landed while it runs', () => {
    const yi = unit('yi', 0);
    const enemy = unit('creep', 60);
    indexObjects(game, [yi, enemy]);

    const before = new Slow(4_000, enemy, yi);
    before.percent = 0.4;
    yi.addBuff(before);

    const spell = new MasterYi_R(yi);
    expect(spell.press(context(yi))).toBe(true);
    expect(before.toRemove).toBe(true);

    const during = new Slow(4_000, enemy, yi);
    during.percent = 0.4;
    yi.addBuff(during);
    spell._aura!.update();
    expect(during.toRemove).toBe(true);
  });
});
