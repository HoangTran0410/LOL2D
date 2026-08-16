import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { createGame, stubGameGlobals } from '../fixtures';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Pet from '../../../src/game/gameObject/attackableUnits/Pet';

/**
 * A summon wears a smaller badge than a champion.
 *
 * The full frame is 125px wide and paints a score box, a mana strip, level
 * ticks, buff icons and status text. A pet has no score to show (it inherits
 * `score = 0` from `Champion` and never changes it), casts nothing so its mana
 * pool is always empty, and dies in seconds — so on a Tibbers or a Shaco box that
 * frame is almost entirely empty chrome, and there can be four of them on
 * screen at once covering the fight they are meant to explain.
 *
 * The compact frame already existed for mobile. This is the same frame, chosen
 * by what the unit *is* rather than by how far the camera happens to be zoomed
 * out.
 */
let spies: Record<string, ReturnType<typeof vi.fn>>;

function makeGame() {
  const game = createGame();
  Object.assign(game.camera, {
    currentScale: 1,
    constantSize: (px: number) => px,
  });
  return game;
}

function champion(game: ReturnType<typeof makeGame>): Champion {
  const unit = new Champion({ game, position: createVector(0, 0) } as never);
  unit.stats.health.baseValue = 50;
  unit.stats.maxHealth.baseValue = 100;
  return unit;
}

function pet(game: ReturnType<typeof makeGame>, ownerUnit: Champion): Pet {
  const unit = new Pet({
    game,
    position: createVector(0, 0),
    ownerUnit,
    lifeTimeMs: 5_000,
  } as never);
  unit.stats.health.baseValue = 50;
  unit.stats.maxHealth.baseValue = 100;
  return unit;
}

beforeEach(() => {
  spies = stubGameGlobals();
});
afterEach(() => vi.unstubAllGlobals());

describe('a pet gets the compact health frame', () => {
  it('draws the narrow bar, not the 125px champion frame', () => {
    const game = makeGame();
    const owner = champion(game);
    game.setPlayer(owner);
    const summon = pet(game, owner);

    summon.drawHealthBar();

    const widths = spies.rect.mock.calls.map(call => call[2]);
    expect(widths.some(w => Math.abs(w - 125) < 0.01)).toBe(false);
    expect(widths.some(w => w <= 60)).toBe(true);
  });

  it('paints no score, because a summon has none to paint', () => {
    const game = makeGame();
    const owner = champion(game);
    game.setPlayer(owner);
    const summon = pet(game, owner);

    summon.drawHealthBar();

    expect(spies.text).not.toHaveBeenCalled();
  });

  it('paints no mana strip when the unit has no mana pool', () => {
    const game = makeGame();
    const owner = champion(game);
    game.setPlayer(owner);
    const summon = pet(game, owner);
    summon.stats.maxMana.baseValue = 0;

    const before = spies.rect.mock.calls.length;
    summon.drawHealthBar();
    const drawn = spies.rect.mock.calls.slice(before);

    // backing + health only; a mana strip would be a third rect at a smaller
    // height sitting below the health one
    expect(drawn.length).toBeLessThanOrEqual(2);
  });

  // The control. Without it the pet assertions above would pass just as well if
  // the full frame had been broken for everyone, which is the likelier mistake.
  it('leaves the champion frame alone', () => {
    const game = makeGame();
    const owner = champion(game);
    game.setPlayer(owner);

    owner.drawHealthBar();
    const championWidest = Math.max(...spies.rect.mock.calls.map(call => call[2]));
    const championTexts = spies.text.mock.calls.length;

    spies.rect.mockClear();
    spies.text.mockClear();
    pet(game, owner).drawHealthBar();
    const petWidest = Math.max(...spies.rect.mock.calls.map(call => call[2]));

    // the champion keeps its wide frame and its score; the pet gets neither
    expect(championWidest).toBeGreaterThan(petWidest * 1.8);
    expect(championTexts).toBeGreaterThan(0);
    expect(spies.text).not.toHaveBeenCalled();
  });
});
