import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn((key: string) => ({ key, path: `/assets/${key}.png`, status: 'ready' })),
    ensure: vi.fn(() => Promise.resolve()),
    getAsset: vi.fn(() => undefined),
  },
}));

import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import TrueSight from '../../../src/game/gameObject/buffs/TrueSight';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import { computeHudState } from '../../../src/game/hud/hudState';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { CAST_TIME_MS as LUX_R_CAST_TIME_MS } from '../../../packs/riot/spells/Lux_R';
import makeLux_R from '../../../packs/riot/spells/Lux_R';
import { makeAshe_E_Object } from '../../../packs/riot/spells/Ashe_E';
import makeLeeSin_Q, { makeLeeSin_Q_Object } from '../../../packs/riot/spells/LeeSin_Q';
import { CAST_TIME_MS as MORGANA_R_CAST_TIME_MS } from '../../../packs/riot/spells/Morgana_R';
import makeMorgana_R from '../../../packs/riot/spells/Morgana_R';
const __api = buildContentApi();
const Lux_R = makeLux_R(__api);
const Ashe_E_Object = makeAshe_E_Object(__api);
const LeeSin_Q = makeLeeSin_Q(__api);
const LeeSin_Q_Object = makeLeeSin_Q_Object(__api);
const Morgana_R = makeMorgana_R(__api);

const unit = (game: TestGame, x = 0, y = 0): AttackableUnit => {
  const created = new AttackableUnit({ game, position: createVector(x, y) });
  created.stats.mana.baseValue = 1_000;
  created.stats.maxMana.baseValue = 1_000;
  return created;
};

const directionContext = (caster: AttackableUnit): CastContext =>
  Object.freeze({
    spellId: 'reveal-probe',
    activationId: 'cast',
    startedAtMs: 0,
    caster,
    origin: Object.freeze({ x: caster.position.x, y: caster.position.y }),
    cursorWorld: Object.freeze({ x: caster.position.x + 100, y: caster.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

/**
 * Ashe's bird, flown over the victim once. It reveals whatever is inside
 * `revealRadius` on each step, which is the whole of its applier.
 */
const asheRevealOn = (ashe: AttackableUnit, victim: AttackableUnit): void => {
  const bird = new Ashe_E_Object(ashe);
  bird.position = victim.position.copy();
  bird.onAfterMove();
};

/** Lux's beam, cast down the +x lane and resolved against whoever is standing in it. */
const luxRevealOn = (lux: AttackableUnit, game: TestGame): void => {
  const spell = new Lux_R(lux);
  spell.press(directionContext(lux));
  vi.stubGlobal('deltaTime', LUX_R_CAST_TIME_MS);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
  const beam = game.objectManager._objectToBeAdd.find(
    (object): object is BeamSpellObject => object instanceof BeamSpellObject
  );
  if (!beam) throw new Error('Lux R must create its beam.');
  beam.update();
};

/** Lee Sin's wave, resolved on whoever it caught. */
const leeSinRevealOn = (lee: AttackableUnit, victim: AttackableUnit, game: TestGame): void => {
  const spell = new LeeSin_Q(lee);
  spell.press(directionContext(lee));
  const wave = game.objectManager._objectToBeAdd.find(
    (object): object is LeeSin_Q_Object => object instanceof LeeSin_Q_Object
  );
  if (!wave) throw new Error('Lee Sin Q must create its wave.');
  wave.onHitCallback?.(victim);
};

/** Morgana's shackles, latched onto everything inside the radius. */
const morganaRevealOn = (morgana: AttackableUnit): void => {
  const spell = new Morgana_R(morgana);
  spell.press(directionContext(morgana));
  vi.stubGlobal('deltaTime', MORGANA_R_CAST_TIME_MS);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

const revealsOn = (victim: AttackableUnit): TrueSight[] =>
  victim.buffs.filter((buff): buff is TrueSight => buff instanceof TrueSight && !buff.toRemove);

describe('TrueSight', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lets two spells reveal the same target without evicting each other', () => {
    const victim = unit(game, 400, 0);
    const ashe = unit(game, 0, 400);
    const lux = unit(game, 0, 0);
    // `isAllied` reads it, and the display bounding box reads `isAllied`.
    game.setPlayer(victim);
    indexObjects(game, [victim]);

    asheRevealOn(ashe, victim);
    const asheReveal = revealsOn(victim)[0];
    expect(asheReveal).toBeDefined();
    const asheDuration = asheReveal.duration;

    luxRevealOn(lux, game);

    const live = revealsOn(victim);
    expect(live).toHaveLength(2);
    // Ashe's three seconds of vision must still be three seconds of vision:
    // a shorter reveal arriving from somewhere else is not a reason to end it.
    expect(asheReveal.toRemove).toBe(false);
    expect(asheReveal.duration).toBe(asheDuration);
    expect(new Set(live.map(reveal => reveal.stackId)).size).toBe(2);
  });

  it('gives each source its own HUD row, wearing that source’s icon', () => {
    const victim = unit(game, 400, 0);
    const ashe = unit(game, 0, 400);
    const lux = unit(game, 0, 0);
    // `isAllied` reads it, and the display bounding box reads `isAllied`.
    game.setPlayer(victim);
    indexObjects(game, [victim]);

    asheRevealOn(ashe, victim);
    luxRevealOn(lux, game);

    const hud = computeHudState({
      player: { buffs: victim.buffs, stats: victim.stats, spells: [] },
    } as never);
    const icons = hud!.buffs.map(row => row.image).sort();

    expect(icons).toEqual(['/assets/spell_ashe_e.png', '/assets/spell_lux_r.png']);
  });

  it('gives all four spells that reveal a slot of their own', () => {
    const victim = unit(game, 400, 0);
    game.setPlayer(victim);
    indexObjects(game, [victim]);

    asheRevealOn(unit(game, 0, 400), victim);
    luxRevealOn(unit(game, 0, 0), game);
    leeSinRevealOn(unit(game, 0, -400), victim, game);
    morganaRevealOn(unit(game, 400, 200));

    const live = revealsOn(victim);
    expect(live).toHaveLength(4);
    expect(new Set(live.map(reveal => reveal.stackId)).size).toBe(4);
    // None of them left on the default, which is the class itself.
    expect(live.every(reveal => typeof reveal.stackId === 'string')).toBe(true);
  });
});
