import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Leblanc_R, { COOLDOWN_MS, MANA_COST } from '../../../src/game/gameObject/spells/Leblanc_R';
import Leblanc_Q, { Leblanc_Q_Object } from '../../../src/game/gameObject/spells/Leblanc_Q';
import Leblanc_W from '../../../src/game/gameObject/spells/Leblanc_W';
import AssetManager from '../../../src/managers/AssetManager';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  TestVector,
  type TestGame,
} from '../spell/fixtures';

// Leblanc_W's real onSpellCast calls VectorUtils.getVectorWithMaxRange, which
// needs `.limit()`. The shared fixture vector does not have one; add it once
// here rather than editing the shared fixture for a method only this file needs.
if (!('limit' in TestVector.prototype)) {
  (TestVector.prototype as unknown as { limit(max: number): TestVector }).limit = function (
    this: TestVector,
    max: number
  ): TestVector {
    const length = Math.hypot(this.x, this.y);
    if (length > max) {
      this.x = (this.x / length) * max;
      this.y = (this.y / length) * max;
    }
    return this;
  };
}

function unit(game: TestGame, x: number, teamId: string) {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.animatedValues.displaySize = 20;
  return result;
}

const selfCastContext = (owner: AttackableUnit, cursorWorld = { x: 0, y: 0 }): CastContext =>
  Object.freeze({
    spellId: 'leblanc-r',
    activationId: 'mimic-activation',
    startedAtMs: 5,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

const qCastContext = (owner: AttackableUnit, target: AttackableUnit): CastContext =>
  Object.freeze({
    spellId: 'leblanc-q',
    activationId: 'q-activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze({ x: target.position.x, y: target.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
    target,
  });

/** Presses Q and drives it to completion, so it actually fires and reports ON_POST_CAST_SPELL. */
function castQToCompletion(spell: Leblanc_Q, context: CastContext): void {
  expect(spell.press(context)).toBe(true);
  vi.stubGlobal('deltaTime', 250);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
}

/**
 * `Leblanc_R.onUpdate` pumps its in-flight clone at whatever `deltaTime` the
 * frame it runs in has — same as every other spell's `update()`. A mimicked
 * `Leblanc_Q` still has its own real cast time, so this drives enough frames
 * for that inner cast to actually resolve, the way the real per-frame
 * `Champion.spells.forEach(spell => spell.update())` loop would.
 */
function pumpMimic(mimic: Leblanc_R, frames = 20): void {
  for (let i = 0; i < frames; i++) mimic.update();
}

describe('Leblanc R (Mimic)', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is wired to its exported tuning: no mana cost, instant, bypasses cooldown of what it copies', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const spell = new Leblanc_R(owner);

    expect(spell.manaCost).toBe(MANA_COST);
    expect(spell.manaCost).toBe(0);
    expect(spell.coolDown).toBe(COOLDOWN_MS);
    expect(spell.castSpec).toMatchObject({
      activation: 'PRESS',
      targeting: 'SELF',
      cooldown: { startAt: 'start', durationMs: COOLDOWN_MS },
    });
  });

  it('defaults to Sigil of Malice aimed at the cursor when nothing has been cast yet', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    game.objectManager.addObject(target);
    game.objectManager.update();

    const mimic = new Leblanc_R(owner);
    mimic.update(); // subscribes to ON_POST_CAST_SPELL, matching every-frame real usage

    expect(mimic.press(selfCastContext(owner, { x: 100, y: 0 }))).toBe(true);
    pumpMimic(mimic);

    const orb = owner.game.objectManager._objectToBeAdd.find(
      (object): object is Leblanc_Q_Object => object instanceof Leblanc_Q_Object
    );
    expect(orb).toBeInstanceOf(Leblanc_Q_Object);
  });

  it('recasts the same ability at the same target, ignoring its cooldown and without paying its cost again', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    owner.stats.mana.baseValue = 500;
    const target = unit(game, 100, 'red');
    game.objectManager.addObject(target);
    game.objectManager.update();
    const takeDamage = vi.spyOn(target, 'takeDamage');

    const mimic = new Leblanc_R(owner);
    mimic.update();

    const q = new Leblanc_Q(owner);
    castQToCompletion(q, qCastContext(owner, target));
    expect(q.state).toBe('COOLDOWN'); // Q is now on its own cooldown
    const manaAfterQ = owner.stats.mana.value;
    // this orb already did its job (getting `target` marked and the ON_POST_CAST_SPELL
    // event out); clear it so the assertions below only see the mimic's own orb
    owner.game.objectManager._objectToBeAdd.length = 0;

    expect(mimic.press(selfCastContext(owner))).toBe(true);
    pumpMimic(mimic);

    // the recast is a brand new instance, so Q being on cooldown never gated it
    const orbs = owner.game.objectManager._objectToBeAdd.filter(
      (object): object is Leblanc_Q_Object => object instanceof Leblanc_Q_Object
    );
    expect(orbs).toHaveLength(1);
    expect(orbs[0].target).toBe(target);

    for (let i = 0; i < 50 && !orbs[0].toRemove; i++) orbs[0].update();
    expect(takeDamage).toHaveBeenCalledWith(orbs[0].damage, owner);

    // Mimic paid its own (zero) cost; the recast must not have charged Q's cost too
    expect(owner.stats.mana.value).toBe(manaAfterQ);
  });

  it('never tracks itself or a spell belonging to someone else', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const other = unit(game, 50, 'red');
    game.setPlayer(owner);

    const mimic = new Leblanc_R(owner);
    mimic.update();

    // Leblanc_R's own completed cast must not become "the last ability to mimic"
    game.eventManager.emit('onUnitCastSpell', mimic);
    // a same-shaped cast belonging to a different unit must not be picked up either
    const foreignQ = new Leblanc_Q(other);
    Object.defineProperty(foreignQ, 'castContext', { get: () => selfCastContext(other) });
    game.eventManager.emit('onUnitCastSpell', foreignQ);

    // still nothing tracked, so pressing Mimic still falls back to the documented default
    const target = unit(game, 0, 'red');
    target.position.set(0, 0);
    game.objectManager.addObject(target);
    game.objectManager.update();

    expect(mimic.press(selfCastContext(owner, { x: 0, y: 0 }))).toBe(true);
    pumpMimic(mimic);
    expect(
      owner.game.objectManager._objectToBeAdd.some(object => object instanceof Leblanc_Q_Object)
    ).toBe(true);
  });

  it('recasts Leblanc_W or Leblanc_E through the same mechanism when that was the last cast', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);

    const mimic = new Leblanc_R(owner);
    mimic.update();

    const w = new Leblanc_W(owner);
    const wContext = selfCastContext(owner, { x: 40, y: 0 });
    // Leblanc_W is a legacy castTimeMs:0 spell — press() resolves synchronously
    w.press(wContext);
    expect(w.state).not.toBe('READY'); // it actually fired (phase advanced / on cooldown)

    const pressSpy = vi.spyOn(Leblanc_W.prototype, 'press').mockImplementation(() => true);
    mimic.press(selfCastContext(owner));

    expect(pressSpy).toHaveBeenCalledTimes(1);
    const [passedContext] = pressSpy.mock.calls[0];
    expect(passedContext.caster).toBe(owner);
    expect(passedContext.cursorWorld).toEqual(wContext.cursorWorld);
    // it is a brand-new instance, not the original spell object
    expect(pressSpy.mock.instances[0]).not.toBe(w);
  });

  it('shows the mimicked ability icon once something has been tracked', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    game.objectManager.addObject(target);
    game.objectManager.update();

    const mimic = new Leblanc_R(owner);
    mimic.update();
    const baseIcon = mimic.image;

    const q = new Leblanc_Q(owner);
    castQToCompletion(q, qCastContext(owner, target));

    expect(mimic.image).not.toBe(baseIcon);
    expect(mimic.image).toBe(AssetManager.get('spell_leblanc_r2'));
  });

  it('cancels an in-flight recast when Mimic is removed, instead of leaking it', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const target = unit(game, 100, 'red');
    game.objectManager.addObject(target);
    game.objectManager.update();

    const mimic = new Leblanc_R(owner);
    mimic.update();
    const q = new Leblanc_Q(owner);
    castQToCompletion(q, qCastContext(owner, target));

    mimic.press(selfCastContext(owner));
    // Q's own CAST_TIME_MS has not elapsed yet, so the mimicked cast is still CASTING
    mimic.onRemoved();

    // no throw, and re-driving update() afterwards must not resurrect it
    expect(() => mimic.update()).not.toThrow();
  });
});
