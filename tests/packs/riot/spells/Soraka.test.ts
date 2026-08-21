import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import Root from '../../../../src/game/gameObject/buffs/Root';
import Silence from '../../../../src/game/gameObject/buffs/Silence';
import Slow from '../../../../src/game/gameObject/buffs/Slow';
import AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { DAMAGE as Q_DAMAGE, FALL_TIME_MS, REJUVENATION_STACK_ID, hasRejuvenation } from '../../../../packs/riot/spells/Soraka_Q';
import makeSoraka_Q, { makeSoraka_Q_Object, makeGrantRejuvenation } from '../../../../packs/riot/spells/Soraka_Q';
import { HEAL as W_HEAL, HEALTH_COST, MIN_HEALTH_RATIO, REJUVENATED_HEALTH_COST } from '../../../../packs/riot/spells/Soraka_W';
import makeSoraka_W from '../../../../packs/riot/spells/Soraka_W';
import { ERUPT_DAMAGE, IMPACT_DAMAGE, ROOT_DURATION_MS, ZONE_DURATION_MS } from '../../../../packs/riot/spells/Soraka_E';
import makeSoraka_E, { makeSoraka_E_Object } from '../../../../packs/riot/spells/Soraka_E';
import { HEAL as R_HEAL, LOW_HEALTH_BONUS, LOW_HEALTH_RATIO } from '../../../../packs/riot/spells/Soraka_R';
import makeSoraka_R from '../../../../packs/riot/spells/Soraka_R';
const __api = buildContentApi();
const Soraka_Q = makeSoraka_Q(__api);
const Soraka_Q_Object = makeSoraka_Q_Object(__api);
const grantRejuvenation = makeGrantRejuvenation(__api);
const Soraka_W = makeSoraka_W(__api);
const Soraka_E = makeSoraka_E(__api);
const Soraka_E_Object = makeSoraka_E_Object(__api);
const Soraka_R = makeSoraka_R(__api);

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 5;
  result.stats.mana.baseValue = 200;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 55;
  return result;
}

const castContext = (
  owner: AttackableUnit,
  cursorWorld: { x: number; y: number },
  target?: unknown
): CastContext =>
  Object.freeze({
    spellId: 'soraka',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 1, y: 0 }),
    ...(target === undefined ? {} : { target }),
  });

describe('Soraka', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Q lands only after the star has fallen, then damages, slows and pays Soraka star dust', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = unit(game, 300, 'red');
    game.objectManager.objects.push(owner, enemy);
    game.objectManager.update(); // builds the quadtree the impact queries

    const spell = new Soraka_Q(owner);
    expect(spell.press(castContext(owner, { x: 300, y: 0 }))).toBe(true);
    spell.update();

    const star = game.objectManager._objectToBeAdd.find(
      (object): object is Soraka_Q_Object => object instanceof Soraka_Q_Object
    );
    if (!star) throw new Error('Soraka Q must create its star.');

    const damage = vi.spyOn(enemy, 'takeDamage');
    star.update(); // 250ms in — still falling
    expect(damage).not.toHaveBeenCalled();
    expect(hasRejuvenation(owner)).toBe(false);

    star.update(); // 500ms in, past FALL_TIME_MS
    expect(FALL_TIME_MS).toBeGreaterThan(250);
    expect(damage).toHaveBeenCalledWith(Q_DAMAGE, owner);
    expect(enemy.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(hasRejuvenation(owner)).toBe(true);
  });

  it('Q pays no star dust when the star lands on nobody', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    game.objectManager.objects.push(owner);
    game.objectManager.update();

    const spell = new Soraka_Q(owner);
    expect(spell.press(castContext(owner, { x: 300, y: 0 }))).toBe(true);
    spell.update();

    const star = game.objectManager._objectToBeAdd.find(
      (object): object is Soraka_Q_Object => object instanceof Soraka_Q_Object
    );
    if (!star) throw new Error('Soraka Q must create its star.');

    for (let i = 0; i < 4; i++) star.update();
    expect(star.hasLanded).toBe(true);
    expect(hasRejuvenation(owner)).toBe(false);
  });

  it('W heals the ally out of Soraka own health, and star dust discounts the price', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const ally = unit(game, 100, 'blue');
    ally.stats.health.baseValue = 40;
    game.objectManager.objects.push(owner, ally);
    game.objectManager.update();

    const heal = vi.spyOn(ally, 'takeHeal');
    const plain = new Soraka_W(owner);
    expect(plain.press(castContext(owner, ally.position, ally))).toBe(true);
    plain.update();

    expect(heal).toHaveBeenCalledWith(W_HEAL, owner);
    expect(plain.healthCost).toBe(HEALTH_COST);
    expect(owner.stats.health.value).toBe(100 - HEALTH_COST);

    grantRejuvenation(owner, owner);
    expect(owner.buffs.some(buff => buff.stackId === REJUVENATION_STACK_ID)).toBe(true);

    const discounted = new Soraka_W(owner);
    expect(discounted.press(castContext(owner, ally.position, ally))).toBe(true);
    expect(discounted.healthCost).toBe(REJUVENATED_HEALTH_COST);
  });

  it('W refuses to fire while Soraka is under her own health floor', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const ally = unit(game, 100, 'blue');
    game.objectManager.objects.push(owner, ally);
    game.objectManager.update();

    // above the raw health cost, but not above the floor plus the cost
    owner.stats.health.baseValue = 100 * MIN_HEALTH_RATIO + HEALTH_COST;
    expect(owner.stats.health.value).toBeGreaterThan(HEALTH_COST);
    expect(new Soraka_W(owner).press(castContext(owner, ally.position, ally))).toBe(false);

    owner.stats.health.baseValue = 100 * MIN_HEALTH_RATIO + HEALTH_COST + 1;
    expect(new Soraka_W(owner).press(castContext(owner, ally.position, ally))).toBe(true);
  });

  it('E silences while the field stands, then roots and damages again when it collapses', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = unit(game, 300, 'red');
    game.objectManager.objects.push(owner, enemy);
    game.objectManager.update();

    const spell = new Soraka_E(owner);
    expect(spell.press(castContext(owner, { x: 300, y: 0 }))).toBe(true);
    spell.update();

    const zone = game.objectManager._objectToBeAdd.find(
      (object): object is Soraka_E_Object => object instanceof Soraka_E_Object
    );
    if (!zone) throw new Error('Soraka E must create its field.');

    zone.update();
    expect(enemy.stats.health.value).toBe(100 - IMPACT_DAMAGE);
    expect(enemy.buffs.some(buff => buff instanceof Silence)).toBe(true);
    expect(enemy.buffs.some(buff => buff instanceof Root)).toBe(false);

    // run past the field's life so it collapses
    for (let i = 0; i < Math.ceil(ZONE_DURATION_MS / 250) + 1; i++) zone.update();

    expect(zone.hasCollapsed).toBe(true);
    expect(enemy.stats.health.value).toBe(100 - IMPACT_DAMAGE - ERUPT_DAMAGE);
    const root = enemy.buffs.find(buff => buff instanceof Root);
    expect(root?.duration).toBe(ROOT_DURATION_MS);
  });

  it('R heals every ally anywhere on the map, harder on the ones nearly dead', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const farAlly = unit(game, 900, 'blue');
    farAlly.stats.health.baseValue = 100 * LOW_HEALTH_RATIO - 1;
    const healthyAlly = unit(game, 400, 'blue');
    const enemy = unit(game, 200, 'red');
    game.objectManager.objects.push(owner, farAlly, healthyAlly, enemy);
    game.objectManager.update();

    const woundedHeal = vi.spyOn(farAlly, 'takeHeal');
    const healthyHeal = vi.spyOn(healthyAlly, 'takeHeal');
    const enemyHeal = vi.spyOn(enemy, 'takeHeal');

    const spell = new Soraka_R(owner);
    expect(spell.press(castContext(owner, owner.position))).toBe(true);
    spell.update();

    expect(woundedHeal).toHaveBeenCalledWith(R_HEAL * (1 + LOW_HEALTH_BONUS), owner);
    expect(healthyHeal).toHaveBeenCalledWith(R_HEAL, owner);
    expect(enemyHeal).not.toHaveBeenCalled();
  });
});
