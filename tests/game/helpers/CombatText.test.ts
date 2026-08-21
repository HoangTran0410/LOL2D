import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import CombatText, {
  COMBAT_TEXT_LIFETIME_MS,
} from '../../../src/game/gameObject/helpers/CombatText';

const combatTexts = (game: ReturnType<typeof createGame>): CombatText[] =>
  [...game.objectManager.objects, ...game.objectManager._objectToBeAdd].filter(
    (object): object is CombatText => object instanceof CombatText
  );

/** Advances the sim by roughly `ms`, in the fixture's fixed 16ms steps. */
const tick = (game: ReturnType<typeof createGame>, ms: number): void => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) game.objectManager.update();
};

// See the doc comment on `CombatText` for the rule this file is pinning down:
// merge per (victim, kind, color) while the existing text is still alive,
// immediately on the first hit, with no separate scheduler or tick.
describe('CombatText.show merges per victim and kind', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('merges two damage hits on the same unit into one running total', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    CombatText.show(unit, 'damage', 10, [255, 0, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('-25');
    expect(texts[0].amount).toBe(25);
  });

  it('keeps two victims apart: 15 and 15 stay two numbers, never one 30', () => {
    const game = createGame();
    const a = createUnit(game, 0, 'blue');
    const b = createUnit(game, 100, 'blue');

    CombatText.show(a, 'damage', 15, [255, 0, 0]);
    CombatText.show(b, 'damage', 15, [255, 0, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(2);
    expect(texts.map(t => t.text).sort()).toEqual(['-15', '-15']);
  });

  it('does not merge across kinds on the same unit', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    CombatText.show(unit, 'heal', 10, [0, 255, 0]);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(2);
    expect(texts.map(t => t.text).sort()).toEqual(['+10', '-15']);
  });

  it('does not merge two differently-colored shields on the same unit', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    // Two different casters' shields, e.g. Malphite W then Lux W landing on
    // the same ally: each has its own color and must show its own number.
    CombatText.show(unit, 'shield', 8, [180, 170, 205]);
    CombatText.show(unit, 'shield', 6, [255, 225, 140]);

    expect(combatTexts(game)).toHaveLength(2);
  });

  it('merges repeated hits eaten by the same shield instance', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');
    const color = [255, 205, 90];

    CombatText.show(unit, 'shield', 8, color);
    CombatText.show(unit, 'shield', 6, color);

    const texts = combatTexts(game);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('14');
  });

  it('updates the same instance in place rather than replacing it', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    const first = combatTexts(game)[0];

    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    const texts = combatTexts(game);

    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(first);
  });

  it('refreshes the lifetime on merge, extending how long it stays on screen', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    tick(game, COMBAT_TEXT_LIFETIME_MS / 2);
    const text = combatTexts(game)[0];
    expect(text.age).toBeGreaterThan(0);

    CombatText.show(unit, 'damage', 5, [255, 0, 0]);
    expect(text.age).toBe(0);
  });

  it('starts a fresh text once the merged one has fully faded, rather than reviving it', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 15, [255, 0, 0]);
    tick(game, COMBAT_TEXT_LIFETIME_MS + 200);

    CombatText.show(unit, 'damage', 8, [255, 0, 0]);

    const live = combatTexts(game).filter(text => !text.toRemove);
    expect(live).toHaveLength(1);
    expect(live[0].text).toBe('-8');
  });

  it('drops a zero-amount event instead of creating an empty text', () => {
    const game = createGame();
    const unit = createUnit(game, 0, 'blue');

    CombatText.show(unit, 'damage', 0, [255, 0, 0]);

    expect(combatTexts(game)).toHaveLength(0);
  });
});
