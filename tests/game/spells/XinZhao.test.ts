import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import EventType from '../../../src/game/enums/EventType';
import Airborne from '../../../src/game/gameObject/buffs/Airborne';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { XINZHAO_Q_ATTACKS, XINZHAO_Q_BONUS_DAMAGE } from '../../../packs/riot/spells/XinZhao_Q';
import makeXinZhao_Q from '../../../packs/riot/spells/XinZhao_Q';
import { XINZHAO_W_SLASH_DAMAGE, XINZHAO_W_THRUST_DAMAGE, XINZHAO_W_THRUST_DELAY_MS } from '../../../packs/riot/spells/XinZhao_W';
import makeXinZhao_W, { makeXinZhao_W_Object } from '../../../packs/riot/spells/XinZhao_W';
import { isChallengedBy, XINZHAO_E_CHALLENGE_STACK_ID } from '../../../packs/riot/spells/XinZhao_E';
import makeXinZhao_E from '../../../packs/riot/spells/XinZhao_E';
import { XINZHAO_R_DAMAGE } from '../../../packs/riot/spells/XinZhao_R';
import makeXinZhao_R from '../../../packs/riot/spells/XinZhao_R';
const __api = buildContentApi();
const XinZhao_Q = makeXinZhao_Q(__api);
const XinZhao_W = makeXinZhao_W(__api);
const XinZhao_W_Object = makeXinZhao_W_Object(__api);
const XinZhao_E = makeXinZhao_E(__api);
const XinZhao_R = makeXinZhao_R(__api);

describe('Xin Zhao', () => {
  let game: TestGame;
  let xin: AttackableUnit;

  function build(x: number, teamId: string): AttackableUnit {
    const unit = createUnit(game, x, teamId);
    unit.position.set(x, 0);
    unit.collisionRadius = 10;
    unit.stats.size.baseValue = 20;
    unit.stats.speed.baseValue = 10;
    unit.stats.mana.baseValue = 200;
    unit.stats.maxHealth.baseValue = 100;
    unit.stats.health.baseValue = 100;
    return unit;
  }

  /** In the manager and indexed, so a spell's own query can find it. */
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
    xin = build(0, 'blue');
    // `isAllied` reads the player, and the manager's own flush asks for it
    game.setPlayer(xin);
    game.objectManager.addObject(xin);
    game.objectManager.update();
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Q pays out over three attacks and knocks the third target up', () => {
    const victim = spawn(60, 'red');
    const q = new XinZhao_Q(xin);
    q.onSpellCast();

    expect(q.stackCount).toBe(XINZHAO_Q_ATTACKS);

    for (let i = 0; i < XINZHAO_Q_ATTACKS; i++) {
      game.eventManager.emit(EventType.ON_ATTACK_HIT, {
        attacker: xin,
        victim,
        damage: 0,
        ranged: false,
      });
    }

    expect(victim.stats.health.value).toBe(100 - XINZHAO_Q_ATTACKS * XINZHAO_Q_BONUS_DAMAGE);
    expect(victim.buffs.some(buff => buff instanceof Airborne)).toBe(true);
    // the window closes on the finisher rather than running to its duration
    expect(q.stackCount).toBeUndefined();
  });

  it('W slashes on cast and thrusts only after the wind-up', () => {
    // inside the arc as well as on the thrust's line, so one cast tests both
    const victim = spawn(120, 'red');
    const w = new XinZhao_W(xin);
    w.onSpellCast();

    const sweep = game.objectManager._objectToBeAdd.find(
      object => object instanceof XinZhao_W_Object
    ) as XinZhao_W_Object;
    expect(sweep).toBeTruthy();

    // one frame: the arcs have started, the spear has not gone out
    sweep.update();
    expect(victim.stats.health.value).toBe(100 - XINZHAO_W_SLASH_DAMAGE);
    expect(victim.buffs.some(buff => buff instanceof Slow)).toBe(false);

    vi.stubGlobal('deltaTime', XINZHAO_W_THRUST_DELAY_MS);
    sweep.update();
    vi.stubGlobal('deltaTime', 16);
    expect(victim.stats.health.value).toBeLessThanOrEqual(100 - XINZHAO_W_THRUST_DAMAGE);
    expect(victim.buffs.some(buff => buff instanceof Slow)).toBe(true);
  });

  it('E charges the enemy it picked and marks it', () => {
    const victim = spawn(200, 'red');
    const e = new XinZhao_E(xin);

    expect(e.findVictim()).toBe(victim);
    e.onSpellCast();

    expect(xin.buffs.some(buff => buff instanceof Dash)).toBe(true);
    expect(victim.buffs.some(buff => buff.stackId === XINZHAO_E_CHALLENGE_STACK_ID)).toBe(true);
    expect(isChallengedBy(victim, xin)).toBe(true);
  });

  it('R throws out everyone it has not marked, and keeps the one it has', () => {
    const marked = spawn(100, 'red');
    const unmarked = spawn(-100, 'red');
    new XinZhao_E(xin).onSpellCast(); // marks the nearest to the cursor at +300

    expect(isChallengedBy(marked, xin)).toBe(true);
    expect(isChallengedBy(unmarked, xin)).toBe(false);

    new XinZhao_R(xin).onSpellCast();

    expect(marked.stats.health.value).toBeLessThan(100 - XINZHAO_R_DAMAGE + 1);
    expect(marked.buffs.some(buff => buff instanceof Dash)).toBe(false);
    expect(unmarked.buffs.some(buff => buff instanceof Dash)).toBe(true);
  });
});
