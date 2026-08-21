import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Dash from '../../../src/game/gameObject/buffs/Dash';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { TRYNDAMERE_Q_AD_BONUS_MAX, TRYNDAMERE_Q_BASE_HEAL, TRYNDAMERE_Q_MAX_HEAL, TRYNDAMERE_Q_MISSING_HEALTH_HEAL, TRYNDAMERE_Q_STACK_ID } from '../../../packs/riot/spells/Tryndamere_Q';
import makeTryndamere_Q from '../../../packs/riot/spells/Tryndamere_Q';
import { TRYNDAMERE_W_AD_REDUCTION, TRYNDAMERE_W_RADIUS, TRYNDAMERE_W_STACK_ID } from '../../../packs/riot/spells/Tryndamere_W';
import makeTryndamere_W from '../../../packs/riot/spells/Tryndamere_W';
import { TRYNDAMERE_E_DAMAGE } from '../../../packs/riot/spells/Tryndamere_E';
import makeTryndamere_E from '../../../packs/riot/spells/Tryndamere_E';
import { TRYNDAMERE_R_STACK_ID } from '../../../packs/riot/spells/Tryndamere_R';
import makeTryndamere_R from '../../../packs/riot/spells/Tryndamere_R';
const __api = buildContentApi();
const Tryndamere_Q = makeTryndamere_Q(__api);
const Tryndamere_W = makeTryndamere_W(__api);
const Tryndamere_E = makeTryndamere_E(__api);
const Tryndamere_R = makeTryndamere_R(__api);

describe('Tryndamere', () => {
  let game: TestGame;
  let tryn: AttackableUnit;

  function build(x: number, teamId: string): AttackableUnit {
    const unit = createUnit(game, x, teamId);
    unit.position.set(x, 0);
    unit.collisionRadius = 10;
    unit.stats.size.baseValue = 20;
    unit.stats.speed.baseValue = 10;
    unit.stats.maxHealth.baseValue = 100;
    unit.stats.health.baseValue = 100;
    unit.stats.attackDamage.baseValue = 20;
    return unit;
  }

  function spawn(x: number, teamId: string): AttackableUnit {
    const unit = build(x, teamId);
    game.objectManager.addObject(unit);
    game.objectManager.update();
    return unit;
  }

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
    tryn = build(0, 'blue');
    game.setPlayer(tryn);
    game.objectManager.addObject(tryn);
    game.objectManager.update();
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Q heals and arms him harder the lower he is, and never past its cap', () => {
    tryn.stats.health.baseValue = 10; // 90 missing out of 100
    const q = new Tryndamere_Q(tryn);

    const expected = TRYNDAMERE_Q_BASE_HEAL + 90 * TRYNDAMERE_Q_MISSING_HEALTH_HEAL;
    expect(q.healAmount()).toBe(expected);
    q.onSpellCast();

    // `takeHeal` deals in whole points, so the pool gets the rounded figure
    expect(tryn.stats.health.value).toBe(10 + Math.round(expected));
    const rage = tryn.buffs.find(buff => buff.stackId === TRYNDAMERE_Q_STACK_ID) as StatAmp;
    expect(rage).toBeTruthy();
    expect(rage.bonuses.attackDamage?.flatBonus).toBe(Math.round(TRYNDAMERE_Q_AD_BONUS_MAX * 0.9));

    // and the gamble has a ceiling: one point of health does not heal for 45+
    tryn.stats.health.baseValue = 1;
    expect(q.healAmount()).toBe(TRYNDAMERE_Q_MAX_HEAL);
  });

  it('W blunts and slows everyone in earshot, and nobody beyond it', () => {
    const near = spawn(200, 'red');
    const far = spawn(TRYNDAMERE_W_RADIUS + 200, 'red');

    new Tryndamere_W(tryn).onSpellCast();

    const cower = near.buffs.find(buff => buff.stackId === TRYNDAMERE_W_STACK_ID) as StatAmp;
    expect(cower.bonuses.attackDamage?.flatBonus).toBe(-TRYNDAMERE_W_AD_REDUCTION);
    expect(near.stats.attackDamage.value).toBe(20 - TRYNDAMERE_W_AD_REDUCTION);
    expect(near.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(far.buffs.length).toBe(0);
  });

  it('E cuts each body it passes exactly once, however many frames it touches it', () => {
    const victim = spawn(60, 'red');
    new Tryndamere_E(tryn).onSpellCast();

    const spin = tryn.buffs.find(buff => buff instanceof Dash) as Dash;
    expect(spin).toBeTruthy();
    spin.onDashUpdate?.();
    spin.onDashUpdate?.();
    spin.onDashUpdate?.();

    expect(victim.stats.health.value).toBe(100 - TRYNDAMERE_E_DAMAGE);
  });

  it('R makes him untouchable for its duration', () => {
    new Tryndamere_R(tryn).onSpellCast();

    const rage = tryn.buffs.find(buff => buff.stackId === TRYNDAMERE_R_STACK_ID);
    expect(rage).toBeTruthy();

    tryn.takeDamage(60, spawn(200, 'red'));
    expect(tryn.stats.health.value).toBe(100);
  });
});
