import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import { stubGameGlobals } from '../fixtures';

const makeSystem = (drawFn: (particle: any) => void = () => undefined) =>
  new ParticleSystem({
    isDeadFn: particle => Boolean(particle.dead),
    drawFn,
  });

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('ParticleSystem render workload', () => {
  it('draws an evenly distributed subset when a limit is supplied', () => {
    const drawn: number[] = [];
    const system = makeSystem(particle => drawn.push(particle.id));
    system.particles = Array.from({ length: 10 }, (_, id) => ({ id }));

    system.draw(3);

    expect(drawn).toEqual([1, 5, 8]);
  });

  it('keeps desktop/default drawing unlimited', () => {
    const drawn: number[] = [];
    const system = makeSystem(particle => drawn.push(particle.id));
    system.particles = Array.from({ length: 10 }, (_, id) => ({ id }));

    system.draw();

    expect(drawn).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('compacts dead particles without splice and preserves survivor order', () => {
    const system = makeSystem();
    const particles = [
      { id: 0, dead: true },
      { id: 1, dead: false },
      { id: 2, dead: true },
      { id: 3, dead: false },
    ];
    particles.splice = (() => {
      throw new Error('splice must not run');
    }) as typeof particles.splice;
    system.particles = particles;

    expect(() => system.update()).not.toThrow();
    expect(system.particles.map(particle => particle.id)).toEqual([1, 3]);
  });
});
