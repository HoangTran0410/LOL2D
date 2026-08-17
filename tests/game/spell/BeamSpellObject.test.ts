import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BeamSpellObject, {
  type BeamGeometry,
} from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import BeamRenderer from '../../../src/game/vfx/BeamRenderer';
import { createGame, createUnit, installSpellObjectGlobals } from './fixtures';

describe('BeamSpellObject', () => {
  beforeEach(installSpellObjectGlobals);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses one capsule geometry for beam hit tests and rendering data', () => {
    const game = createGame();
    const owner = createUnit(game);
    const target = createUnit(game, 50, 'red');
    const geometry: BeamGeometry = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      width: 20,
    };
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
    const game = createGame();
    const owner = createUnit(game);
    const target = createUnit(game, 50, 'red');
    const onHit = vi.fn();
    const beam = new BeamSpellObject(
      owner,
      {
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        width: 20,
      },
      {
        candidates: () => [target, target],
        onHit,
        instant: true,
      }
    );

    beam.update();
    beam.update();

    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledWith(target);
    expect(beam.toRemove).toBe(true);
  });

  it('owns the finite lifetime of a duration beam', () => {
    const game = createGame();
    const owner = createUnit(game);
    const target = createUnit(game, 50, 'red');
    const onHit = vi.fn();
    const beam = new BeamSpellObject(
      owner,
      {
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        width: 20,
      },
      {
        candidates: () => [target],
        onHit,
        instant: false,
        durationMs: 100,
      }
    );

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
    durationMs => {
      const game = createGame();
      expect(
        () =>
          new BeamSpellObject(
            createUnit(game),
            {
              start: { x: 0, y: 0 },
              end: { x: 100, y: 0 },
              width: 20,
            },
            { instant: false, durationMs }
          )
      ).toThrow('durationMs must be finite and greater than 0');
    }
  );
});
