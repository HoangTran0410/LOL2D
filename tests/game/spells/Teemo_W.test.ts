import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Teemo_W, {
  DURATION_MS,
  MANA_COST,
  SPEED_PERCENT,
  Teemo_W_Burst,
} from '../../../src/game/gameObject/spells/Teemo_W';
import Speedup from '../../../src/game/gameObject/buffs/Speedup';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import teemoWSource from '../../../src/game/gameObject/spells/Teemo_W.ts?raw';

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy(): TestVector {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
}

const context: CastContext = {
  spellId: 'teemo-w',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: { x: 0, y: 0 },
  cursorWorld: { x: 0, y: 0 },
  direction: { x: 0, y: 0 },
};

const owner = () => {
  const objects: unknown[] = [];
  const buffs: unknown[] = [];
  const manaStat = {
    baseValue: 200,
    get value() {
      return this.baseValue;
    },
    set value(value: number) {
      this.baseValue = value;
    },
  };
  return {
    position: new TestVector(5, 5),
    isDead: false,
    canCast: true,
    animatedValues: { displaySize: 55 },
    stats: { mana: manaStat, health: { value: 100 } },
    game: {
      eventManager: { emit: vi.fn() },
      objectManager: { addObject: (object: unknown) => objects.push(object) },
    },
    addBuff: vi.fn((buff: unknown) => buffs.push(buff)),
    objects,
    buffs,
  };
};

describe('Teemo W', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('grants a self speed buff tagged with its own stack id, not the bare Speedup slot', () => {
    const caster = owner();
    const spell = new Teemo_W(caster);

    expect(spell.press(context)).toBe(true);

    const buff = caster.buffs[0] as Speedup;
    expect(buff).toBeInstanceOf(Speedup);
    expect(buff.percent).toBe(SPEED_PERCENT);
    expect(buff.duration).toBe(DURATION_MS);
    expect(buff.stackId).toBe('teemo_w_movequick');
    expect(caster.stats.mana.value).toBe(200 - MANA_COST);
  });

  it('never touches owner.position/teleportTo — this is a stat buff, not a dash', () => {
    expect(teemoWSource).not.toMatch(/\.teleportTo\(/);
  });

  it('spawns a self-expiring cast burst that tracks the caster and then removes itself', () => {
    const caster = owner();
    const spell = new Teemo_W(caster);
    spell.press(context);

    const burst = caster.objects[0] as Teemo_W_Burst;
    expect(burst).toBeInstanceOf(Teemo_W_Burst);

    caster.position.set(40, 40);
    burst.update();
    expect(burst.position).toMatchObject({ x: 40, y: 40 });
    expect(burst.toRemove).toBeFalsy();

    vi.stubGlobal('deltaTime', burst.lifeTime + 1);
    burst.update();
    expect(burst.toRemove).toBe(true);
  });

  it('removes itself immediately if the caster dies, rather than lingering', () => {
    const caster = owner();
    const spell = new Teemo_W(caster);
    spell.press(context);
    const burst = caster.objects[0] as Teemo_W_Burst;

    caster.isDead = true;
    burst.update();

    expect(burst.toRemove).toBe(true);
  });

  it('draws the activation pulse procedurally and covers it with the bounding box', () => {
    const caster = owner();
    const burst = new Teemo_W_Burst(caster as never);

    const draw = { ellipse: vi.fn(), line: vi.fn() };
    for (const [name, spy] of Object.entries(draw)) vi.stubGlobal(name, spy);
    for (const name of [
      'push',
      'pop',
      'translate',
      'fill',
      'stroke',
      'noFill',
      'noStroke',
      'strokeWeight',
    ]) {
      vi.stubGlobal(name, vi.fn());
    }
    vi.stubGlobal('constrain', (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), high)
    );
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);
    vi.stubGlobal('TWO_PI', Math.PI * 2);

    burst.draw();
    expect(draw.ellipse).toHaveBeenCalled();
    expect(draw.line).toHaveBeenCalled();

    const box = burst.getDisplayBoundingBox();
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });
});
