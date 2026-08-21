import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import Speedup from '../../../src/game/gameObject/buffs/Speedup';
import TrueSight from '../../../src/game/gameObject/buffs/TrueSight';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { CAST_TIME_MS, INITIAL_DAMAGE, LATCH_RADIUS, MANA_COST, RESOLVE_DAMAGE, SELF_HASTE_PERCENT, SLOW_PERCENT, STUN_DURATION_MS, TETHER_DURATION_MS, TETHER_RANGE } from '../../../packs/riot/spells/Morgana_R';
import makeMorgana_R, { makeMorgana_R_Tether, makeMorgana_R_Tether_Object } from '../../../packs/riot/spells/Morgana_R';
const __api = buildContentApi();
const Morgana_R = makeMorgana_R(__api);
const Morgana_R_Tether = makeMorgana_R_Tether(__api);
const Morgana_R_Tether_Object = makeMorgana_R_Tether_Object(__api);

const context = (owner: { position: { x: number; y: number } }): CastContext =>
  Object.freeze({
    spellId: 'morgana-r',
    activationId: 'activation',
    startedAtMs: 0,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

const releaseCast = (spell: Morgana_R): void => {
  vi.stubGlobal('deltaTime', CAST_TIME_MS);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Morgana R (Soul Shackles)', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is wired to its exported tuning', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const spell = new Morgana_R(owner);

    expect(spell.manaCost).toBe(MANA_COST);
    expect(spell.castSpec).toMatchObject({
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: CAST_TIME_MS,
      cooldown: { startAt: 'end', durationMs: spell.coolDown },
    });
  });

  it('latches every enemy in range, damages, slows and reveals them, and hastes Morgana', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    game.setPlayer(owner);
    const inRange = createUnit(game, LATCH_RADIUS - 10, 'red');
    const outOfRange = createUnit(game, LATCH_RADIUS + 200, 'red');
    const ally = createUnit(game, 10, 'blue');
    game.objectManager.addObject(inRange);
    game.objectManager.addObject(outOfRange);
    game.objectManager.addObject(ally);
    game.objectManager.update();

    const inRangeDamage = vi.spyOn(inRange, 'takeDamage');
    const outOfRangeDamage = vi.spyOn(outOfRange, 'takeDamage');
    const allyDamage = vi.spyOn(ally, 'takeDamage');

    const spell = new Morgana_R(owner);
    spell.press(context(owner));
    releaseCast(spell);

    expect(inRangeDamage).toHaveBeenCalledWith(INITIAL_DAMAGE, owner);
    expect(outOfRangeDamage).not.toHaveBeenCalled();
    expect(allyDamage).not.toHaveBeenCalled();

    const slow = inRange.buffs.find((buff): buff is Slow => buff instanceof Slow);
    expect(slow).toMatchObject({ percent: SLOW_PERCENT, duration: TETHER_DURATION_MS });
    expect(inRange.buffs.find(buff => buff instanceof TrueSight)).toBeTruthy();
    expect(inRange.buffs.find(buff => buff instanceof Morgana_R_Tether)).toBeTruthy();

    const haste = owner.buffs.find((buff): buff is Speedup => buff instanceof Speedup);
    expect(haste).toMatchObject({ percent: SELF_HASTE_PERCENT, duration: TETHER_DURATION_MS });
  });

  it('does nothing and stays off cooldown-affecting state when no enemy is in range', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    game.setPlayer(owner);
    const far = createUnit(game, LATCH_RADIUS + 500, 'red');
    game.objectManager.addObject(far);
    game.objectManager.update();

    const spell = new Morgana_R(owner);
    spell.press(context(owner));
    releaseCast(spell);

    expect(owner.buffs.find(buff => buff instanceof Speedup)).toBeUndefined();
  });

  it('stuns and deals resolve damage to a target still in range when the tether expires', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const target = createUnit(game, 0, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');

    const tether = new Morgana_R_Tether_Object(owner).attachTo(target);
    tether.target = target;

    tether.update(TETHER_DURATION_MS);

    expect(tether.toRemove).toBe(true);
    expect(takeDamage).toHaveBeenCalledWith(RESOLVE_DAMAGE, owner);
    const stun = target.buffs.find((buff): buff is Stun => buff instanceof Stun);
    expect(stun).toMatchObject({ duration: STUN_DURATION_MS });
  });

  it('does not stun a target that ran outside tether range before it resolved', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const target = createUnit(game, 0, 'red');
    const takeDamage = vi.spyOn(target, 'takeDamage');

    const tether = new Morgana_R_Tether_Object(owner).attachTo(target);
    tether.target = target;

    // still short of the resolve moment, but already past TETHER_RANGE
    target.position.set(TETHER_RANGE + 50, 0);
    tether.update(TETHER_DURATION_MS - 500);

    expect(tether.toRemove).toBe(true);
    expect(takeDamage).not.toHaveBeenCalled();
    expect(target.buffs.find(buff => buff instanceof Stun)).toBeUndefined();

    // and it must not resolve later even if update() kept being called
    tether.update(1_000);
    expect(takeDamage).not.toHaveBeenCalled();
  });

  it('clears the slow, reveal and mark the instant the tether ends, whichever way', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const target = createUnit(game, 0, 'red');

    const slow = new Slow(TETHER_DURATION_MS, owner, target);
    target.addBuff(slow);
    const reveal = new TrueSight(TETHER_DURATION_MS, owner, target);
    target.addBuff(reveal);
    const mark = new Morgana_R_Tether(TETHER_DURATION_MS, owner, target);
    target.addBuff(mark);

    const tether = new Morgana_R_Tether_Object(owner).attachTo(target);
    tether.target = target;
    tether.slowBuff = slow;
    tether.revealBuff = reveal;
    tether.markBuff = mark;

    target.position.set(TETHER_RANGE + 50, 0);
    tether.update(16);

    expect(slow.toRemove).toBe(true);
    expect(reveal.toRemove).toBe(true);
    expect(mark.toRemove).toBe(true);
  });

  it('drops the tether the instant either end of it leaves the world', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const target = createUnit(game, 0, 'red');
    const tether = new Morgana_R_Tether_Object(owner).attachTo(target);
    tether.target = target;

    target.die({ reviveAfter: 5_000 });
    tether.update(16);
    expect(tether.toRemove).toBe(true);

    const ownerTether = new Morgana_R_Tether_Object(owner).attachTo(target);
    ownerTether.target = target;
    owner.die({ reviveAfter: 5_000 });
    ownerTether.update(16);
    expect(ownerTether.toRemove).toBe(true);
  });

  it('draws a procedural tether line and marker rather than blitting the ability icon', () => {
    for (const name of [
      'push',
      'pop',
      'translate',
      'fill',
      'noFill',
      'stroke',
      'noStroke',
      'strokeWeight',
      'blendMode',
      'ADD',
      'BLEND',
      // the chain draws rotated links, so the tether needs these two as well
      'rotate',
      'ellipse',
    ]) {
      vi.stubGlobal(name, name === 'ADD' || name === 'BLEND' ? name : vi.fn());
    }
    const image = vi.fn();
    const line = vi.fn();
    const circle = vi.fn();
    vi.stubGlobal('image', image);
    vi.stubGlobal('line', line);
    vi.stubGlobal('circle', circle);

    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const target = createUnit(game, 300, 'red');
    const tether = new Morgana_R_Tether_Object(owner).attachTo(target);
    tether.target = target;
    tether.elapsedMs = 500;

    tether.draw();

    expect(image).not.toHaveBeenCalled();
    expect(line).toHaveBeenCalled();
    expect(circle).toHaveBeenCalled();

    const box = tether.getDisplayBoundingBox();
    expect(box.x).toBeLessThanOrEqual(owner.position.x);
    expect(box.x + box.w).toBeGreaterThanOrEqual(target.position.x);
  });
});
