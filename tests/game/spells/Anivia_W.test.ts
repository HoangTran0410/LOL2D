/**
 * Crystallize must block the person who cast it.
 *
 * The slab resolves an overlapping body to its *nearest* face, which is right
 * for someone walking into it from outside and catastrophic for someone
 * standing inside it: past the midplane the nearest face is the far one, so the
 * push ejects them straight through the wall. Measured on the shipped 34px
 * slab — a champion whose centre starts on the midplane is 44.5px beyond the
 * wall one frame later, and walks away free.
 *
 * Anivia is the one person that reliably happens to. The slab is centred on the
 * aim point, and on a phone the aim point is wherever the thumb rests, which is
 * usually right on top of her own champion. So the wall blocked both teams and
 * let its caster stroll through, which reads as the ability being broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Anivia_W, { Anivia_W_Object } from '../../../src/game/gameObject/spells/Anivia_W';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { createGame, stubGameGlobals, withWalls, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  vi.stubGlobal('HALF_PI', Math.PI / 2);
  game = createGame();
  withWalls(game, []);
});
afterEach(() => vi.unstubAllGlobals());

const anivia = (x = 500, y = 500): Champion => {
  const unit = new Champion({ game, teamId: 'blue' });
  unit.position.set(x, y);
  unit.destination.set(x, y);
  unit.stats.mana.baseValue = 100;
  game.setPlayer(unit);
  game.objectManager.addObject(unit);
  return unit;
};

const castAt = (caster: Champion, at: { x: number; y: number }): CastContext => {
  const dx = at.x - caster.position.x;
  const dy = at.y - caster.position.y;
  const length = Math.hypot(dx, dy);
  return Object.freeze({
    spellId: 'anivia-w',
    activationId: 'activation',
    startedAtMs: 1,
    caster,
    origin: Object.freeze({ x: caster.position.x, y: caster.position.y }),
    cursorWorld: Object.freeze({ x: at.x, y: at.y }),
    direction: Object.freeze({
      x: length === 0 ? 0 : dx / length,
      y: length === 0 ? 0 : dy / length,
    }),
  }) as CastContext;
};

/** Casts W at `at` and hands back the slab it put in the world. */
const crystallize = (caster: Champion, at: { x: number; y: number }): Anivia_W_Object => {
  const spell = new Anivia_W(caster);
  expect(spell.press(castAt(caster, at))).toBe(true);
  spell.update();
  const slab = game.objectManager._objectToBeAdd.find(
    object => object instanceof Anivia_W_Object
  ) as Anivia_W_Object | undefined;
  if (!slab) throw new Error('Anivia W must put a slab in the world.');
  return slab;
};

/** How far the caster's centre must stay from the slab's centre plane to be outside it. */
const clearanceFor = (unit: Champion, slab: Anivia_W_Object) =>
  slab.thickness / 2 + unit.stats.size.value / 2;

describe('the slab never spawns on top of its caster', () => {
  it('is pushed clear even when aimed at her own feet', () => {
    const caster = anivia();
    const slab = crystallize(caster, { x: caster.position.x, y: caster.position.y });

    expect(caster.position.dist(slab.position)).toBeGreaterThanOrEqual(clearanceFor(caster, slab));
  });

  it('is pushed clear at every aim distance from her feet outwards', () => {
    const tooClose: string[] = [];
    for (let aimed = 0; aimed <= 400; aimed += 10) {
      game = createGame();
      withWalls(game, []);
      const caster = anivia();
      const slab = crystallize(caster, {
        x: caster.position.x + aimed,
        y: caster.position.y,
      });
      const gap = caster.position.dist(slab.position);
      if (gap < clearanceFor(caster, slab)) tooClose.push(`aim ${aimed} -> gap ${gap.toFixed(1)}`);
    }
    expect(tooClose).toEqual([]);
  });
});

describe('the slab blocks whoever walks into it', () => {
  /** Walks `unit` at `towardX` for `frames` and answers where it ended up. */
  const walk = (unit: Champion, towardX: number, frames = 150): number => {
    for (let frame = 0; frame < frames; frame++) {
      unit.moveTo(towardX, unit.position.y);
      game.objectManager.update();
    }
    return unit.position.x;
  };

  it('stops its caster, cast point blank, on her own side', () => {
    const caster = anivia();
    const slab = crystallize(caster, { x: caster.position.x, y: caster.position.y });
    game.objectManager.update();

    const ended = walk(caster, caster.position.x + 400);

    expect(ended).toBeLessThan(slab.position.x - slab.thickness / 2);
  });

  it('still stops a stranger walking into it — the fix must not unblock the wall', () => {
    const caster = anivia();
    const slab = crystallize(caster, { x: caster.position.x + 300, y: caster.position.y });
    game.objectManager.update();

    const stranger = new Champion({ game, teamId: 'red' });
    stranger.position.set(slab.position.x + 200, slab.position.y);
    stranger.destination.set(stranger.position.x, stranger.position.y);
    game.objectManager.addObject(stranger);
    game.objectManager.update();

    const ended = walk(stranger, slab.position.x - 400);

    expect(ended).toBeGreaterThan(slab.position.x + slab.thickness / 2);
  });
});
