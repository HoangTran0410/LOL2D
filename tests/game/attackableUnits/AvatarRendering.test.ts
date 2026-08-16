import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
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

  it('keeps health, mana and shield bars but omits text and ticks in compact mode', () => {
    const game = createGame();
    Object.assign(game.camera, { constantSize: (pixels: number) => pixels });
    const champion = new Champion({ game, position: createVector(50, 50) });
    game.setPlayer(champion);
    champion.stats.health.baseValue = champion.stats.maxHealth.value / 2;
    champion.stats.mana.baseValue = champion.stats.maxMana.value / 2;

    champion.drawHealthBar(true);

    expect(spies.rect.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(spies.text).not.toHaveBeenCalled();
    expect(spies.line).not.toHaveBeenCalled();
  });
});
