import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));
import Airborne from '../../../../src/game/gameObject/buffs/Airborne';
import Dash from '../../../../src/game/gameObject/buffs/Dash';
import AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import EventType from '../../../../src/game/enums/EventType';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { Q_MAX_CHARGE_MS, Q_MAX_DAMAGE, Q_MAX_DISTANCE, Q_MIN_DAMAGE, Q_MIN_DISTANCE, viQDamage, viQDashDistance } from '../../../../packs/riot/spells/Vi_Q';
import makeVi_Q from '../../../../packs/riot/spells/Vi_Q';
import { W_ATTACK_SPEED, W_PROC, W_STACKS } from '../../../../packs/riot/spells/Vi_W';
import makeVi_W from '../../../../packs/riot/spells/Vi_W';
import { E_CHARGES, E_DAMAGE } from '../../../../packs/riot/spells/Vi_E';
import makeVi_E from '../../../../packs/riot/spells/Vi_E';
import { R_DAMAGE, R_PASS_DAMAGE } from '../../../../packs/riot/spells/Vi_R';
import makeVi_R from '../../../../packs/riot/spells/Vi_R';
const __api = buildContentApi();
const Vi_Q = makeVi_Q(__api);
const Vi_W = makeVi_W(__api);
const Vi_E = makeVi_E(__api);
const Vi_R = makeVi_R(__api);

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

describe('Vi spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(600, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  /** A hand-built cast context: createGame's createSpellContext returns undefined. */
  function context(dx: number, dy: number, target?: AttackableUnit) {
    return {
      spellId: 'test',
      activationId: 'test',
      startedAtMs: 0,
      caster: owner,
      origin: { x: owner.position.x, y: owner.position.y },
      cursorWorld: { x: owner.position.x + dx, y: owner.position.y + dy },
      direction: { x: Math.sign(dx), y: Math.sign(dy) },
      target,
    } as any;
  }

  /** What `landBasicAttack` broadcasts once a swing has already dealt its damage. */
  function swing(victim: AttackableUnit, attacker: AttackableUnit = owner) {
    game.eventManager.emit(EventType.ON_ATTACK_HIT, {
      attacker,
      victim,
      damage: 5,
      ranged: false,
      crit: false,
    });
  }

  function liveDash(unitWithBuff: AttackableUnit): Dash {
    const found = unitWithBuff.buffs.find(buff => buff instanceof Dash);
    if (!found) throw new Error('no dash buff on the unit');
    return found as Dash;
  }

  it('Q interpolates distance and damage across the charge, ends included', () => {
    // Written out by hand: 200..420 and 15..30, so half a charge is 310 for 22.5.
    expect(viQDashDistance(0)).toBe(Q_MIN_DISTANCE);
    expect(viQDashDistance(0.5)).toBe(310);
    expect(viQDashDistance(1)).toBe(Q_MAX_DISTANCE);
    expect(viQDamage(0)).toBe(Q_MIN_DAMAGE);
    expect(viQDamage(0.5)).toBe(22.5);
    expect(viQDamage(1)).toBe(Q_MAX_DAMAGE);
  });

  it('Q at zero charge still fires, at the minimum', () => {
    const q = new Vi_Q(owner);
    const ctx = context(600, 0);
    q.onCastStart(ctx);
    q.onSpellCast(ctx);
    const dash = liveDash(owner);
    expect(dash.dashDestination?.x).toBeCloseTo(Q_MIN_DISTANCE, 4);
  });

  it('Q stops on the first enemy and leaves the one behind it alone', () => {
    const first = unit(game, 40, 'red');
    const behind = unit(game, 200, 'red');
    game.objectManager.addObject(first);
    game.objectManager.addObject(behind);
    game.objectManager.update();

    const q = new Vi_Q(owner);
    const ctx = context(600, 0);
    q.onCastStart(ctx);
    q.onChargeUpdate(ctx, Q_MAX_CHARGE_MS, 1);
    q.onSpellCast(ctx);

    const dash = liveDash(owner);
    dash.update();

    expect(first.stats.health.value).toBe(100 - Q_MAX_DAMAGE);
    expect(behind.stats.health.value).toBe(100);
    expect(first.buffs.some(buff => buff instanceof Airborne)).toBe(true);
    expect(dash.toRemove).toBe(true);
  });

  it('W procs on the third hit against one victim and never on split hits', () => {
    const alone = unit(game, 60, 'red');
    const split = unit(game, 60, 'red');
    const other = unit(game, 90, 'red');

    const w = new Vi_W(owner);
    w.onSpellCast();

    swing(alone);
    swing(alone);
    expect(alone.stats.health.value).toBe(100);
    swing(alone);
    expect(alone.stats.health.value).toBe(100 - W_PROC);

    swing(split);
    swing(split);
    swing(other);
    swing(other);
    expect(split.stats.health.value).toBe(100);
    expect(other.stats.health.value).toBe(100);
  });

  it("W's proc resets that victim's counter and hastes Vi", () => {
    const victim = unit(game, 60, 'red');
    const w = new Vi_W(owner);
    w.onSpellCast();

    for (let i = 0; i < W_STACKS; i++) swing(victim);
    expect(owner.stats.attackSpeed.value).toBeCloseTo(0.5, 5);

    swing(victim);
    swing(victim);
    expect(victim.stats.health.value).toBe(100 - W_PROC);
    swing(victim);
    expect(victim.stats.health.value).toBe(100 - W_PROC * 2);
  });

  it('E cleaves past the victim of the swing, sparing them, once', () => {
    const victim = unit(game, 80, 'red');
    const bystander = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.addObject(bystander);
    game.objectManager.update();

    const e = new Vi_E(owner);
    e.onSpellCast();
    swing(victim);

    expect(victim.stats.health.value).toBe(100);
    expect(bystander.stats.health.value).toBe(100 - E_DAMAGE);

    swing(victim);
    expect(bystander.stats.health.value).toBe(100 - E_DAMAGE);
  });

  it('E holds two charges: a third press inside one cooldown fires nothing', () => {
    const e = new Vi_E(owner);
    expect(e.stackCount).toBe(E_CHARGES);
    e.onSpellCast();
    e.onSpellCast();
    expect(e.stackCount).toBe(0);
    e.onSpellCast();
    expect(e.stackCount).toBe(0);
    expect(e.checkCastCondition()).toBe(false);

    vi.stubGlobal('deltaTime', e.coolDown);
    e.onUpdate();
    expect(e.stackCount).toBe(1);
  });

  it('R blasts the chosen target and knocks a bystander aside without stopping', () => {
    const target = unit(game, 300, 'red');
    const bystander = unit(game, 40, 'red');
    game.objectManager.addObject(target);
    game.objectManager.addObject(bystander);
    game.objectManager.update();

    const r = new Vi_R(owner);
    r.onSpellCast(context(300, 0, target));
    const dash = liveDash(owner);

    dash.update();
    expect(bystander.stats.health.value).toBe(100 - R_PASS_DAMAGE);
    expect(dash.toRemove).toBe(false);

    for (let i = 0; i < 60 && !dash.toRemove; i++) dash.update();

    expect(target.stats.health.value).toBe(100 - R_DAMAGE);
    expect(target.buffs.some(buff => buff instanceof Airborne)).toBe(true);
    expect(bystander.stats.health.value).toBe(100 - R_PASS_DAMAGE);
  });

  it('R refuses to target self or ally and does not dash into or damage self', () => {
    const r = new Vi_R(owner);
    const ally = unit(game, 200, 'blue');
    game.objectManager.addObject(ally);
    game.objectManager.update();

    r.onSpellCast(context(0, 0, owner));
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);
    expect(owner.tally.damageTaken).toBe(0);

    r.onSpellCast(context(200, 0, ally));
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);
    expect(ally.tally.damageTaken).toBe(0);

    const pressed = r.press(context(0, 0));
    expect(pressed).toBe(false);
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);
  });
});
