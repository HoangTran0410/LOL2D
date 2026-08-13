import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Varus_Q, {
  ARROW_SIZE,
  ARROW_SPEED,
  ARROW_VISUAL_HEIGHT,
  ARROW_VISUAL_WIDTH,
  DAMAGE_CHARGE_MS,
  MANA_COST,
  MAX_CENTER_TRAVEL,
  MAX_CHARGE_MS,
  MAX_DAMAGE,
  MIN_CENTER_TRAVEL,
  RANGE_CHARGE_MS,
  SELF_SLOW_PERCENT,
  Varus_Q_Arrow,
} from '../../../src/game/gameObject/spells/Varus_Q';
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

const stubDrawGlobals = () => {
  const spies = {
    image: vi.fn(), line: vi.fn(), triangle: vi.fn(), vertex: vi.fn(), quad: vi.fn(),
    beginShape: vi.fn(), endShape: vi.fn(), strokeWeight: vi.fn(),
  };
  for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
  for (const name of ['push', 'pop', 'translate', 'rotate', 'blendMode', 'fill', 'stroke', 'noFill', 'noStroke', 'strokeCap']) {
    vi.stubGlobal(name, vi.fn());
  }
  for (const name of ['ADD', 'BLEND', 'CLOSE', 'SQUARE', 'ROUND']) vi.stubGlobal(name, name);
  return spies;
};

describe('Varus Q', () => {
  beforeEach(() => vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y)));
  afterEach(() => vi.unstubAllGlobals());

  it('draws a procedural arrow rather than blitting the ability icon', () => {
    const draw = stubDrawGlobals();
    const arrow = new Varus_Q_Arrow(owner() as never);
    arrow.destination = new Vector(100, 0) as never;

    arrow.draw();

    expect(draw.image).not.toHaveBeenCalled();
    expect(arrow.image).toBeUndefined();
    // barbed head + blight core, plus two swept-back fletching quads. The
    // fletching must not be triangles meeting at the tail: that reads as a
    // second arrowhead and is exactly what this replaced.
    expect(draw.beginShape).toHaveBeenCalled();
    expect(draw.triangle).toHaveBeenCalledTimes(1);
    expect(draw.quad).toHaveBeenCalledTimes(2);
  });

  it('draws a heavier bolt the longer the shot was charged', () => {
    const widestStroke = (chargeRatio: number) => {
      const draw = stubDrawGlobals();
      const arrow = new Varus_Q_Arrow(owner() as never);
      arrow.destination = new Vector(100, 0) as never;
      arrow.chargeRatio = chargeRatio;
      arrow.draw();
      return Math.max(...draw.strokeWeight.mock.calls.map(([weight]) => weight as number));
    };

    expect(widestStroke(1)).toBeGreaterThan(widestStroke(0));
  });

  it('enters CHARGING on keydown and releases a missile on keyup', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);

    spell.press(context(1, 0));
    expect(spell.state).toBe('CHARGING');
    spell.release(context(1, 0));

    const arrow = caster.objects[0] as Varus_Q_Arrow;
    expect(arrow).toBeInstanceOf(Varus_Q_Arrow);
    expect(arrow.destination).toMatchObject({ x: 100, y: 0 });
    expect(arrow.size).toBe(ARROW_SIZE);
    expect(arrow).toMatchObject({ visualWidth: ARROW_VISUAL_WIDTH, visualHeight: ARROW_VISUAL_HEIGHT });
    expect(arrow.speed).toBeCloseTo(ARROW_SPEED);
    expect(spell.state).toBe('COOLDOWN');
  });

  it('samples live cursor direction and scales range and damage', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    vi.stubGlobal('deltaTime', DAMAGE_CHARGE_MS);
    spell.update();
    spell.hold(context(0, 1));
    spell.release(context(0, 1));

    const arrow = caster.objects[0] as Varus_Q_Arrow;
    expect(arrow.destination).toMatchObject({ x: 0 });
    expect(arrow.destination.y).toBeCloseTo(
      MIN_CENTER_TRAVEL + (MAX_CENTER_TRAVEL - MIN_CENTER_TRAVEL) * (DAMAGE_CHARGE_MS / RANGE_CHARGE_MS),
      2
    );
    expect(arrow.damage).toBe(MAX_DAMAGE);
  });

  it('uses the fresh key-up aim even when no final hold event ran', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));

    spell.release(context(0, 1));

    expect((caster.objects[0] as Varus_Q_Arrow).destination).toMatchObject({ x: 0, y: MIN_CENTER_TRAVEL });
  });

  it('caps missile center travel once range finishes charging', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    spell.onChargeUpdate(context(1, 0), RANGE_CHARGE_MS, 1);
    spell.release(context(1, 0));

    expect((caster.objects[0] as Varus_Q_Arrow).destination.x).toBe(MAX_CENTER_TRAVEL);
  });

  it('exposes a monotonically growing live charge range', () => {
    const spell = new Varus_Q(owner());

    spell.onChargeUpdate(context(1, 0), 0, 0);
    const start = spell.currentRange;
    spell.onChargeUpdate(context(1, 0), RANGE_CHARGE_MS / 2, 0.5);
    const middle = spell.currentRange;
    spell.onChargeUpdate(context(1, 0), RANGE_CHARGE_MS, 1);

    expect(start).toBe(MIN_CENTER_TRAVEL);
    expect(middle).toBeGreaterThan(start);
    expect(spell.currentRange).toBe(MAX_CENTER_TRAVEL);
  });

  it('applies and removes its researched self slow', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    expect(caster.buffs[0].percent).toBe(SELF_SLOW_PERCENT);

    spell.release(context(1, 0));
    expect(caster.buffs[0].toRemove).toBe(true);
  });

  it('follows the imported maximum-hold cancel rule', () => {
    const caster = owner();
    const spell = new Varus_Q(caster);
    spell.press(context(1, 0));
    vi.stubGlobal('deltaTime', MAX_CHARGE_MS);
    spell.update();

    expect(caster.objects).toHaveLength(0);
    expect(caster.stats.mana.value).toBe(100 - MANA_COST / 2);
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
    expect(caster.stats.mana.value).toBe(100 - MANA_COST / 2);
  });

  it('applies its direct half-cost adjustment to a real Stat base value', () => {
    const caster = owner();
    const stats = new Stats();
    stats.mana.baseValue = 100;
    caster.stats = stats as typeof caster.stats;

    new Varus_Q(caster).onCancel(context(1, 0), 'MAX_DURATION');

    expect(stats.mana.baseValue).toBe(100 - MANA_COST / 2);
  });
});
