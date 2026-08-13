import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Varus_Q, { Varus_Q_Arrow } from '../../../src/game/gameObject/spells/Varus_Q';
import Stats from '../../../src/game/gameObject/Stats';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class Vector {
  constructor(public x = 0, public y = 0) {}
  copy(): Vector { return new Vector(this.x, this.y); }
  dist(other: Vector): number { return Math.hypot(this.x - other.x, this.y - other.y); }
}

const context = (x: number, y: number): CastContext => Object.freeze({
  spellId: 'varus-q', activationId: `${x}:${y}`, startedAtMs: 0, caster: {},
  origin: Object.freeze({ x: 0, y: 0 }), cursorWorld: Object.freeze({ x, y }),
  direction: Object.freeze({ x, y }),
});

const owner = () => {
  const objects: unknown[] = [];
  const buffs: { percent: number; toRemove: boolean }[] = [];
  const mana = {
    baseValue: 100,
    get value() { return this.baseValue; },
    set value(value: number) { this.baseValue = value; },
  };
  return {
    position: new Vector(), teamId: 'blue', isDead: false, canCast: true,
    stats: { mana, health: { value: 100 }, addModifier: vi.fn(), removeModifier: vi.fn() },
    game: { eventManager: { emit: vi.fn() }, objectManager: { addObject: (object: unknown) => objects.push(object) } },
    addBuff: (buff: { percent: number; toRemove: boolean; activateBuff(): void }) => {
      buffs.push(buff);
      buff.activateBuff();
    }, objects, buffs,
  };
};

describe('Varus Q', () => {
  beforeEach(() => vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y)));
  afterEach(() => vi.unstubAllGlobals());

  it('enters CHARGING on keydown and releases a missile on keyup', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);

    spell.press(context(1, 0));
    expect(spell.state).toBe('CHARGING');
    spell.release(context(1, 0));

    const arrow = caster.objects[0] as Varus_Q_Arrow;
    expect(arrow).toBeInstanceOf(Varus_Q_Arrow);
    expect(arrow.destination).toMatchObject({ x: 825, y: 0 });
    expect(arrow.size).toBe(36);
    expect(arrow).toMatchObject({ visualWidth: 90, visualHeight: 32 });
    expect(arrow.speed).toBeCloseTo(1_900 / 60);
    expect(spell.coolDown).toBe(5_000);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('samples live cursor direction and scales range and damage', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    vi.stubGlobal('deltaTime', 1_250);
    spell.update();
    spell.hold(context(0, 1));
    spell.release(context(0, 1));

    const arrow = caster.objects[0] as Varus_Q_Arrow;
    expect(arrow.destination).toMatchObject({ x: 0 });
    expect(arrow.destination.y).toBeCloseTo(1_408.33, 2);
    expect(arrow.damage).toBe(30);
  });

  it('caps missile center travel at 1525 after range finishes charging', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    spell.onChargeUpdate(context(1, 0), 1_500, 1);
    spell.release(context(1, 0));

    expect((caster.objects[0] as Varus_Q_Arrow).destination.x).toBe(1_525);
  });

  it('exposes a monotonically growing live charge range', () => {
    const spell = new Varus_Q(owner());

    spell.onChargeUpdate(context(1, 0), 0, 0);
    const start = spell.currentRange;
    spell.onChargeUpdate(context(1, 0), 750, 0.5);
    const middle = spell.currentRange;
    spell.onChargeUpdate(context(1, 0), 1_500, 1);

    expect(start).toBe(825);
    expect(middle).toBeGreaterThan(start);
    expect(spell.currentRange).toBe(1_525);
  });

  it('applies and removes its researched self slow', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    expect(caster.buffs[0].percent).toBe(0.2);

    spell.release(context(1, 0));
    expect(caster.buffs[0].toRemove).toBe(true);
  });

  it('follows the imported maximum-hold cancel rule', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    vi.stubGlobal('deltaTime', 4_000);
    spell.update();

    expect(caster.objects).toHaveLength(0);
    expect(caster.stats.mana.value).toBe(75);
    expect(spell.state).toBe('COOLDOWN');
  });

  it.each([
    ['death', (caster: ReturnType<typeof owner>) => { caster.isDead = true; }],
    ['cast-inhibiting status', (caster: ReturnType<typeof owner>) => { caster.canCast = false; }],
  ])('cancels charging on %s and keeps the imported half-mana refund', (_name, interrupt) => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    interrupt(caster);
    vi.stubGlobal('deltaTime', 16);

    spell.update();

    expect(spell.state).toBe('COOLDOWN');
    expect(caster.stats.mana.value).toBe(75);
  });

  it('applies its direct half-cost adjustment to a real Stat base value', () => {
    const caster = owner();
    const stats = new Stats();
    stats.mana.baseValue = 100;
    caster.stats = stats as typeof caster.stats;

    new Varus_Q(caster).onCancel(context(1, 0), 'MAX_DURATION');

    expect(stats.mana.baseValue).toBe(75);
  });
});
