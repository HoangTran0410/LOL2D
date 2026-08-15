import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { createGame, stubGameGlobals } from '../fixtures';

let spies: Record<string, ReturnType<typeof vi.fn>>;
let context: {
  globalAlpha: number;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  spies = stubGameGlobals();
  context = {
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
  };
  vi.stubGlobal('drawingContext', context);
});
afterEach(() => vi.unstubAllGlobals());

describe('AttackableUnit avatar transparency', () => {
  it('uses native canvas alpha instead of p5 tint', () => {
    const game = createGame();
    const unit = new AttackableUnit({ game, position: createVector(0, 0) });
    game.setPlayer(unit);
    unit.animatedValues.displaySize = 50;
    unit.animatedValues.alpha = 128;

    unit.drawAvatar();

    expect(spies.tint).not.toHaveBeenCalled();
    expect(context.globalAlpha).toBeCloseTo(128 / 255);
  });
});
