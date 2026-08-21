import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));
import type { CastContext } from '../../../../src/game/spell/runtime/types';
import type { MatchRules } from '../../../../src/game/config/PregameConfig';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { DAMAGE_TICK_MS, EMPOWERED_DAMAGE, EMPOWERED_SLOW, EMPOWERED_SLOW_DURATION_MS, END_RADIUS, GROWTH_MS, MANA_COST, NORMAL_DAMAGE, NORMAL_SLOW, NORMAL_SLOW_DURATION_MS, START_RADIUS, stormRadiusAt, TETHER_RANGE, UPKEEP_COST, UPKEEP_TICK_MS } from '../../../../packs/riot/spells/Anivia_R';
import makeAnivia_R, { makeAnivia_R_Object } from '../../../../packs/riot/spells/Anivia_R';
const __api = buildContentApi();
const Anivia_R = makeAnivia_R(__api);
const Anivia_R_Object = makeAnivia_R_Object(__api);

const URF: MatchRules = { cooldownMultiplier: 1, manaFree: true };

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}

  copy(): TestVector {
    return new TestVector(this.x, this.y);
  }
  limit(maximum: number): TestVector {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > maximum) {
      this.x = (this.x / magnitude) * maximum;
      this.y = (this.y / magnitude) * maximum;
    }
    return this;
  }
}

Object.assign(globalThis, {
  createVector: (x = 0, y = 0) => new TestVector(x, y),
  map: (value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number) =>
    toLow + ((value - fromLow) / (fromHigh - fromLow)) * (toHigh - toLow),
  p5: {
    Vector: {
      add: (left: TestVector, right: TestVector) =>
        new TestVector(left.x + right.x, left.y + right.y),
      sub: (left: TestVector, right: TestVector) =>
        new TestVector(left.x - right.x, left.y - right.y),
    },
  },
});

const vector = (x: number, y: number): p5.Vector => new TestVector(x, y) as unknown as p5.Vector;

const context = (cursorWorld: { x: number; y: number }): CastContext => ({
  spellId: 'anivia-r',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: { x: 0, y: 0 },
  cursorWorld,
  direction: { x: 1, y: 0 },
});

const setup = (mana = 240, matchRules?: MatchRules) => {
  const added: Anivia_R_Object[] = [];
  const enemy = {
    position: new TestVector(100, 0),
    collisionRadius: 0,
    damage: [] as number[],
    buffs: [] as unknown[],
    takeDamage(damage: number) {
      this.damage.push(damage);
    },
    addBuff(buff: unknown) {
      this.buffs.push(buff);
    },
  };
  const manaStat = {
    baseValue: mana,
    get value() {
      return this.baseValue;
    },
    set value(value: number) {
      this.baseValue = value;
    },
  };
  const owner = {
    game: {
      worldMouse: { x: 100, y: 0 },
      matchRules,
      eventManager: { emit: vi.fn() },
      objectManager: {
        addObject: (object: Anivia_R_Object) => added.push(object),
        queryObjects: vi.fn(() => [enemy]),
      },
    },
    position: vector(0, 0),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    inStasis: false,
    hasBuff: vi.fn(function (this: { inStasis: boolean }, BuffClass: { name: string }) {
      return this.inStasis && BuffClass.name === 'Stasis';
    }),
    stats: { mana: manaStat, health: { value: 100 } },
  };

  return { spell: new Anivia_R(owner), owner, enemy, added };
};

const updateSpell = (spell: Anivia_R, deltaMs: number) => {
  vi.stubGlobal('deltaTime', deltaMs);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Anivia R', () => {
  it('creates one ACTIVE storm at the selected point', () => {
    const { spell, added } = setup();

    spell.press(context({ x: 300, y: 0 }));

    expect(spell.state).toBe('ACTIVE');
    expect(added).toHaveLength(1);
    expect(added[0].center).toEqual({ x: 300, y: 0 });
  });

  it('lets Anivia move and cast while the storm remains active', () => {
    const { spell, owner } = setup();

    spell.press(context({ x: 300, y: 0 }));
    owner.position.x = 200;
    spell.update();

    expect(spell.state).toBe('ACTIVE');
  });

  it('applies the initial damage and slow tick at 0ms', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));

    expect(added[0].radius).toBe(START_RADIUS);
    expect(enemy.damage).toEqual([NORMAL_DAMAGE / 2]);
    expect(enemy.buffs).toHaveLength(1);
    expect(enemy.buffs[0]).toMatchObject({
      percent: NORMAL_SLOW,
      duration: NORMAL_SLOW_DURATION_MS,
    });
  });

  it('grows and empowers damage and slow once the storm finishes growing', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(GROWTH_MS);

    expect(added[0].radius).toBe(END_RADIUS);
    expect(enemy.damage).toEqual([
      NORMAL_DAMAGE / 2,
      NORMAL_DAMAGE / 2,
      NORMAL_DAMAGE / 2,
      EMPOWERED_DAMAGE,
    ]);
    // 4 Slow ticks (0/500/1000/1500ms) plus one Chilled mark, applied once the
    // storm's damage tick lands empowered — see Anivia_E's Frostbite passive.
    expect(enemy.buffs).toHaveLength(5);
    expect(enemy.buffs.at(-1)).toMatchObject({
      percent: EMPOWERED_SLOW,
      duration: EMPOWERED_SLOW_DURATION_MS,
    });
  });

  it('uses each due tick radius when catching up a long frame', () => {
    const { spell, added, enemy } = setup();
    enemy.position.x = 280;

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(GROWTH_MS);

    expect(enemy.damage).toEqual([EMPOWERED_DAMAGE]);
    // the one empowered tick that reaches it applies both the Slow and the
    // Chilled mark Frostbite reads.
    expect(enemy.buffs).toHaveLength(2);
  });

  it('queries the radius checkpoints the storm actually grows through', () => {
    const { spell, owner, added } = setup();

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(GROWTH_MS);

    const radii = owner.game.objectManager.queryObjects.mock.calls.map(
      ([query]) => query.area.r as number
    );
    expect(radii).toContain(stormRadiusAt(0));
    expect(radii).toContain(stormRadiusAt(DAMAGE_TICK_MS));
    expect(radii).toContain(stormRadiusAt(DAMAGE_TICK_MS * 2));
    expect(radii).toContain(stormRadiusAt(GROWTH_MS));
  });

  it('pays mana on activation, then upkeep mana once per second', () => {
    const { spell, owner } = setup();
    const startingMana = owner.stats.mana.value;

    spell.press(context({ x: 100, y: 0 }));
    expect(owner.stats.mana.value).toBe(startingMana - MANA_COST);
    updateSpell(spell, UPKEEP_TICK_MS - 1);
    expect(owner.stats.mana.value).toBe(startingMana - MANA_COST);
    updateSpell(spell, 1);

    expect(owner.stats.mana.value).toBe(startingMana - MANA_COST - UPKEEP_COST);
  });

  // The storm bills its own upkeep outside the base class's commit path, which
  // is exactly how it used to miss URF: both the deduction *and* the
  // affordability check that precedes it have to read the rule, or the channel
  // still shuts off at low mana while costing nothing.
  it('charges neither the cast nor the upkeep under URF', () => {
    const { spell, owner } = setup(240, URF);
    const startingMana = owner.stats.mana.value;

    spell.press(context({ x: 100, y: 0 }));
    expect(owner.stats.mana.value).toBe(startingMana);
    updateSpell(spell, UPKEEP_TICK_MS * 3);

    expect(owner.stats.mana.value).toBe(startingMana);
  });

  it('keeps the storm up on an empty mana pool under URF', () => {
    const { spell, added } = setup(0, URF);

    spell.press(context({ x: 100, y: 0 }));
    updateSpell(spell, UPKEEP_TICK_MS * 2);

    expect(spell.state).toBe('ACTIVE');
    expect(added[0].toRemove).toBe(false);
  });

  it('does not mistake Stasis for interrupting crowd control', () => {
    const { spell, owner, added } = setup();
    spell.press(context({ x: 100, y: 0 }));
    owner.canCast = false;
    owner.inStasis = true;

    spell.update();

    expect(spell.state).toBe('ACTIVE');
    expect(added[0].toRemove).toBe(false);
  });

  it('ends after a permitted second press', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));
    spell.press(context({ x: 100, y: 0 }));

    expect(spell.state).toBe('COOLDOWN');
    expect(added[0].toRemove).toBe(true);
    expect(enemy.damage).toEqual([NORMAL_DAMAGE / 2, NORMAL_DAMAGE / 2]);
  });

  it.each([
    [
      'death',
      (owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => {
        owner.isDead = true;
        spell.update();
      },
    ],
    [
      'no mana',
      (owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => {
        owner.stats.mana.baseValue = 0;
        updateSpell(spell, UPKEEP_TICK_MS);
      },
    ],
    [
      'tether violation',
      (owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => {
        owner.position.x = TETHER_RANGE + 150;
        spell.update();
      },
    ],
    [
      'silence',
      (_owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => {
        spell.cancel('SILENCE');
      },
    ],
  ])('ends on %s', (_reason, end) => {
    const { spell, owner, added } = setup();

    spell.press(context({ x: 100, y: 0 }));
    end(owner, spell);

    expect(spell.state).toBe('COOLDOWN');
    expect(added[0].toRemove).toBe(true);
  });

  it('applies a final damage tick on gameplay cancellation', () => {
    const { spell, added, enemy } = setup();
    spell.press(context({ x: 100, y: 0 }));

    spell.cancel('OUT_OF_RANGE');

    expect(added[0].toRemove).toBe(true);
    expect(enemy.damage).toEqual([NORMAL_DAMAGE / 2, NORMAL_DAMAGE / 2]);
  });

  it('starts cooldown and cleans storm members exactly once', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(DAMAGE_TICK_MS);
    spell.press(context({ x: 100, y: 0 }));
    spell.press(context({ x: 100, y: 0 }));
    added[0].onRemoved();
    added[0].onRemoved();

    expect(spell.currentCooldown).toBe(spell.coolDown);
    expect(added[0].members?.size).toBe(0);
    expect(enemy.damage).toEqual([NORMAL_DAMAGE / 2, NORMAL_DAMAGE / 2, NORMAL_DAMAGE / 2]);
  });

  it('tears down its active area idempotently on deactivate and removal', () => {
    const { spell, added } = setup();
    spell.press(context({ x: 100, y: 0 }));

    spell.deactivate();
    spell.onRemoved();

    expect(added[0].toRemove).toBe(true);
    expect(spell.activeStorm).toBeUndefined();
  });

  it('tears down its active storm through base spell deactivation exactly once', () => {
    const { spell, added } = setup();
    const onCancel = vi.spyOn(spell, 'onCancel');
    spell.press(context({ x: 100, y: 0 }));

    spell.deactivate();
    spell.onRemoved();

    expect(added[0].toRemove).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(spell.state).toBe('READY');
    expect(spell.currentCooldown).toBe(0);
  });
});
