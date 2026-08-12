import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BeamSpellObject, {
  type BeamGeometry,
  type BeamTarget,
} from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import BeamRenderer from '../../../src/game/vfx/BeamRenderer';

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

describe('BeamSpellObject', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses one capsule geometry for beam hit tests and rendering data', () => {
    const geometry: BeamGeometry = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      width: 20,
    };
    const target: BeamTarget = { position: { x: 50, y: 0 }, collisionRadius: 5 };
    const hitTest = vi.fn(() => true);
    const beam = new BeamSpellObject(owner, geometry, {
      candidates: () => [target],
      hitTest,
    });
    const renderer = new BeamRenderer(beam.geometry);

    beam.update();

    expect(hitTest).toHaveBeenCalledWith(target, geometry);
    expect(beam.geometry).toBe(geometry);
    expect(renderer.geometry).toBe(geometry);
  });

  it('hits each target once when configured as an instant beam', () => {
    const target: BeamTarget = { position: { x: 50, y: 0 }, collisionRadius: 5 };
    const onHit = vi.fn();
    const beam = new BeamSpellObject(owner, {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      width: 20,
    }, {
      candidates: () => [target, target],
      onHit,
      instant: true,
    });

    beam.update();
    beam.update();

    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledWith(target);
    expect(beam.toRemove).toBe(true);
  });

  it('owns the finite lifetime of a duration beam', () => {
    const target: BeamTarget = { position: { x: 50, y: 0 }, collisionRadius: 5 };
    const onHit = vi.fn();
    const beam = new BeamSpellObject(owner, {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      width: 20,
    }, {
      candidates: () => [target],
      onHit,
      instant: false,
      durationMs: 100,
    });

    beam.update(99);
    expect(beam.toRemove).toBe(false);
    beam.update(1);
    beam.update(100);

    expect(beam.elapsedMs).toBe(100);
    expect(beam.toRemove).toBe(true);
    expect(onHit).toHaveBeenCalledOnce();
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid duration beam lifetime %s',
    (durationMs) => {
      expect(() => new BeamSpellObject(owner, {
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        width: 20,
      }, { instant: false, durationMs })).toThrow('durationMs must be finite and greater than 0');
    }
  );
});
