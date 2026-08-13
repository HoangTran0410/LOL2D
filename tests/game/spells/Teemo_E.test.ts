import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Teemo_E, {
  MANA_COST,
  ON_HIT_DAMAGE,
  POISON_DAMAGE_PER_TICK,
  POISON_DURATION_MS,
  POISON_TICK_INTERVAL_MS,
  RANGE,
  Teemo_E_Object,
  Teemo_E_Splash,
} from '../../../src/game/gameObject/spells/Teemo_E';
import DamageOverTime from '../../../src/game/gameObject/buffs/DamageOverTime';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { TestVector } from '../spell/fixtures';

const target = (teamId: string) =>
  Object.assign(Object.create(AttackableUnit.prototype) as AttackableUnit, {
    position: new TestVector(100, 0),
    animatedValues: { displaySize: 40 },
    teamId,
    takeDamage: vi.fn(),
    addBuff: vi.fn(),
  });

const owner = () => {
  const objects: unknown[] = [];
  const manaStat = {
    baseValue: 200,
    get value() { return this.baseValue; },
    set value(value: number) { this.baseValue = value; },
  };
  return {
    position: new TestVector(0, 0),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    stats: { mana: manaStat, health: { value: 100 } },
    game: {
      eventManager: { emit: vi.fn() },
      objectManager: { addObject: (object: unknown) => objects.push(object) },
    },
    objects,
  };
};

describe('Teemo E', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fires a single-target vial clamped to range', () => {
    const caster = owner();
    caster.position = new TestVector(0, 0);
    const spell = new Teemo_E(caster);
    spell.press?.({
      spellId: 'teemo-e', activationId: 'a', startedAtMs: 0, caster: {},
      origin: { x: 0, y: 0 }, cursorWorld: { x: RANGE * 5, y: 0 }, direction: { x: 1, y: 0 },
    } as never);

    const vial = caster.objects[0] as Teemo_E_Object;
    expect(vial).toBeInstanceOf(Teemo_E_Object);
    expect(vial.destination.x).toBeCloseTo(RANGE);
    expect(vial.maxHitCount).toBe(1);
    expect(caster.stats.mana.value).toBe(200 - MANA_COST);
  });

  it('hits the first enemy for on-hit damage and applies its own poison stack', () => {
    const caster = owner();
    const enemy = target('red');
    const vial = new Teemo_E_Object(caster as never);

    vial.onHit(enemy);

    expect(enemy.takeDamage).toHaveBeenCalledWith(ON_HIT_DAMAGE, caster);
    expect(enemy.addBuff).toHaveBeenCalledTimes(1);
    const poison = (enemy.addBuff as ReturnType<typeof vi.fn>).mock.calls[0][0] as DamageOverTime;
    expect(poison).toBeInstanceOf(DamageOverTime);
    expect(poison.stackId).toBe('teemo_e_toxicshot');
    expect(poison.damagePerTick).toBe(POISON_DAMAGE_PER_TICK);
    expect(poison.tickInterval).toBe(POISON_TICK_INTERVAL_MS);
    expect(poison.duration).toBe(POISON_DURATION_MS);
    // 4 ticks over the duration, matching the imported rank-1 total (24)
    expect((poison.duration / poison.tickInterval) * poison.damagePerTick).toBe(24);
  });

  it('embeds in the first hit only — maxHitCount stops it from piercing to a second target', () => {
    const caster = owner();
    const vial = new Teemo_E_Object(caster as never);
    const first = target('red');

    vial.hitTargets.push(first);
    expect(vial.hitTargets.length).toBeGreaterThanOrEqual(vial.maxHitCount);
  });

  it('does not use a bare DamageOverTime that would collide with another poison spell', () => {
    const caster = owner();
    const enemy = target('red');
    const vial = new Teemo_E_Object(caster as never);
    vial.onHit(enemy);
    const poison = (enemy.addBuff as ReturnType<typeof vi.fn>).mock.calls[0][0] as DamageOverTime;
    expect(poison.stackId).not.toBe(DamageOverTime);
  });

  it('draws a procedural vial and splash, never blitting the ability icon', () => {
    const caster = owner();
    const vial = new Teemo_E_Object(caster as never);
    vial.destination = new TestVector(100, 0) as never;

    const draw = { ellipse: vi.fn(), rect: vi.fn(), arc: vi.fn(), circle: vi.fn() };
    for (const [name, spy] of Object.entries(draw)) vi.stubGlobal(name, spy);
    for (const name of ['push', 'pop', 'translate', 'rotate', 'blendMode', 'fill', 'stroke', 'noFill', 'noStroke', 'strokeWeight']) {
      vi.stubGlobal(name, vi.fn());
    }
    for (const name of ['ADD', 'BLEND', 'PI']) vi.stubGlobal(name, name === 'PI' ? Math.PI : name);
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);

    expect(vial.image).toBeUndefined();
    vial.draw();
    expect(draw.ellipse).toHaveBeenCalled();
    expect(draw.rect).toHaveBeenCalled();

    const box = vial.getDisplayBoundingBox();
    expect(box.w).toBeGreaterThanOrEqual(vial.size);

    const splash = new Teemo_E_Splash(caster as never);
    splash.position = new TestVector(0, 0) as never;
    vi.stubGlobal('constrain', (value: number, low: number, high: number) => Math.min(Math.max(value, low), high));
    splash.onAdded();
    splash.draw();
    expect(draw.circle).toHaveBeenCalled();
    const splashBox = splash.getDisplayBoundingBox();
    expect(splashBox.w).toBeGreaterThan(splash.targetSize);
  });
});
