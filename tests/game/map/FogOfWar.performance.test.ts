import { describe, expect, it, vi } from 'vitest';
import FogOfWar from '../../../src/game/gameObject/map/FogOfWar';

describe('FogOfWar render caching', () => {
  it('reuses sight visibility until the world or camera changes', () => {
    const queryObjects = vi.fn(() => []);
    const cameraBox = { x: 0, y: 0, w: 800, h: 400 };
    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    fog.game = {
      camera: { getBoundingBox: () => cameraBox },
      player: { teamId: 'blue' },
      objectManager: { revision: 1, objects: [], queryObjects },
    };

    const first = fog.calculateSight();
    const second = fog.calculateSight();

    expect(second).toBe(first);
    expect(queryObjects).toHaveBeenCalledOnce();

    fog.game.objectManager.revision++;
    fog.calculateSight();
    expect(queryObjects).toHaveBeenCalledTimes(2);

    cameraBox.x++;
    fog.calculateSight();
    expect(queryObjects).toHaveBeenCalledTimes(3);
  });

  it('reuses obstacle segments when only the radius changes', () => {
    const fog = Object.create(FogOfWar.prototype) as FogOfWar;
    const obstacles = [{ id: 'wall-a' }, { id: 'bush-b' }];
    const signature = fog.buildObstacleSignature as any;

    expect(signature.call(fog, obstacles, 500)).toBe(signature.call(fog, obstacles, 501));
  });
});
