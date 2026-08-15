import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Game from '../../../src/game/Game';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import { Rectangle } from '../../../src/libs/quadtree';
import { createGame, indexObjects, stubGameGlobals } from '../fixtures';

const camera = {
  getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 100, h: 100 }),
  constantSize: (pixels: number) => pixels,
};

const drawParticles = (touchUi: boolean): number => {
  let drawn = 0;
  const manager = new ObjectManager({ mapSize: 1_000, camera, touchUi });
  manager.objects = Array.from({ length: 2 }, () => {
    const system = new ParticleSystem({
      isDeadFn: () => false,
      drawFn: () => drawn++,
      getParticlePosFn: particle => particle,
      getParticleSizeFn: () => 4,
    });
    system.particles = Array.from({ length: 1_000 }, () => ({ x: 50, y: 50 }));
    return system;
  });
  for (const object of manager.objects) {
    manager._objectsTree.insert(object.getDisplayBoundingBox());
  }

  manager.draw();
  return drawn;
};

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('ObjectManager mobile rendering', () => {
  it('keeps the mobile render budget in sync with the live touch toggle', () => {
    const game = {
      touchUi: false,
      touchControls: {
        enabled: false,
        setEnabled(enabled: boolean) {
          this.enabled = enabled;
        },
      },
      applyTouchUiClass: vi.fn(),
    };

    Game.prototype.setTouchControlsEnabled.call(game as unknown as Game, true, false);

    expect(game.touchUi).toBe(true);
  });

  it('shares one 800-particle draw budget across visible systems', () => {
    expect(drawParticles(true)).toBe(800);
  });

  it('keeps pointer rendering unlimited', () => {
    expect(drawParticles(false)).toBe(2_000);
  });

  it('does not draw an allied body whose vision box alone intersects the camera', () => {
    const game = createGame();
    Object.assign(game.camera, camera);
    const unit = new AttackableUnit({
      game,
      position: createVector(1_050, 50),
      visionRadius: 1_000,
    });
    game.setPlayer(unit);
    unit.draw = vi.fn();
    indexObjects(game, [unit]);

    game.objectManager.draw();

    expect(unit.draw).not.toHaveBeenCalled();
  });
});
