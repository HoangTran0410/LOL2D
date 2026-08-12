import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AreaSpellObject, {
  type AreaTarget,
} from '../../../src/game/gameObject/spellObjects/AreaSpellObject';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
}

const vector = (x: number, y: number): p5.Vector =>
  new TestVector(x, y) as unknown as p5.Vector;

const owner = {
  game: { objectManager: { queryObjects: vi.fn(() => []) } },
  position: vector(0, 0),
  teamId: 'blue',
};

interface TestAreaTarget extends AreaTarget {
  position: TestVector;
}

describe('AreaSpellObject', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('fires area enter tick and exit callbacks in order', () => {
    const target: TestAreaTarget = { position: new TestVector(5, 0), collisionRadius: 0 };
    const events: string[] = [];
    const area = new AreaSpellObject(owner, { x: 0, y: 0 }, 10, {
      candidates: () => [target],
      tickEveryMs: 100,
      onEnter: () => events.push('enter'),
      onTick: () => events.push('tick'),
      onExit: () => events.push('exit'),
    });

    area.update(50);
    area.update(50);
    target.position.x = 20;
    area.update(1);

    expect(events).toEqual(['enter', 'tick', 'exit']);
  });

  it('grows an area radius over its configured duration', () => {
    const area = new AreaSpellObject(owner, { x: 10, y: 20 }, 10, {
      candidates: () => [],
      radiusAt: elapsedMs => 10 + elapsedMs / 100,
    });

    area.update(500);

    expect(area.radius).toBe(15);
    expect(area.center).toEqual({ x: 10, y: 20 });
  });

  it('caps growth and ticks at the remaining duration on a long frame', () => {
    const target: AreaTarget = { position: { x: 0, y: 0 }, collisionRadius: 0 };
    const onTick = vi.fn();
    const radiusAt = vi.fn((elapsedMs: number) => elapsedMs / 10);
    const area = new AreaSpellObject(owner, { x: 0, y: 0 }, 0, {
      candidates: () => [target],
      durationMs: 250,
      tickEveryMs: 100,
      radiusAt,
      onTick,
    });

    area.update(1_000);

    expect(area.elapsedMs).toBe(250);
    expect(area.radius).toBe(25);
    expect(radiusAt).toHaveBeenLastCalledWith(250);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(area.toRemove).toBe(true);
  });

  it.each([
    ['tickEveryMs', { tickEveryMs: Number.NaN }],
    ['tickEveryMs', { tickEveryMs: Number.POSITIVE_INFINITY }],
    ['durationMs', { durationMs: Number.NaN }],
    ['durationMs', { durationMs: Number.POSITIVE_INFINITY }],
  ])('rejects a non-finite %s', (_field, options) => {
    expect(() => new AreaSpellObject(owner, { x: 0, y: 0 }, 10, options))
      .toThrow(`${_field} must be finite and greater than 0`);
  });
});
