import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals } from '../fixtures';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

let spies: Record<string, ReturnType<typeof vi.fn>>;

const unitAtScale = (currentScale: number | null): AttackableUnit => {
  const game = createGame();
  // The fixture's camera answers `getBoundingBox` only — which is exactly the
  // "no camera" case a headless spell test produces.
  if (currentScale !== null) {
    Object.assign(game.camera, {
      currentScale,
      constantSize: (px: number) => px / currentScale,
    });
  }
  const unit = new AttackableUnit({ game, position: createVector(0, 0) });
  // `drawHealthBar` reads `isAllied`, which reads `game.player`; the fixture
  // throws until one is set.
  game.setPlayer(unit);
  unit.stats.health.baseValue = 50;
  unit.stats.maxHealth.baseValue = 100;
  return unit;
};

beforeEach(() => {
  spies = stubGameGlobals();
});
afterEach(() => vi.unstubAllGlobals());

describe('drawHealthBar compensates for camera scale', () => {
  // The pair rule from the spec: compensating the text but not the bar gives
  // 12px digits over a 39px bar, which is worse than either extreme. Both
  // assertions are in one test on purpose — they must not be able to pass
  // separately.
  it('at 0.39 the bar and its text are both scaled up in world units', () => {
    unitAtScale(0.39).drawHealthBar();

    const barWidths = spies.rect.mock.calls.map(call => call[2]);
    expect(barWidths.some(w => Math.abs(w - 100 / 0.39) < 0.01)).toBe(true);
    expect(spies.textSize).toHaveBeenCalledWith(expect.closeTo(12 / 0.39, 5));
  });

  it('at scale 1 nothing changes from the shipped numbers', () => {
    unitAtScale(1).drawHealthBar();
    expect(spies.rect.mock.calls.map(c => c[2])).toContain(100);
    expect(spies.textSize).toHaveBeenCalledWith(12);
  });

  // Headless spell tests build units with no camera at all. A hard dependency
  // here would break dozens of existing files.
  it('survives a game with no camera', () => {
    expect(() => unitAtScale(null).drawHealthBar()).not.toThrow();
    expect(spies.textSize).toHaveBeenCalledWith(12);
  });
});
