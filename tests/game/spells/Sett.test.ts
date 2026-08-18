import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import EventType from '../../../src/game/enums/EventType';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import Sett_E, { SETT_E_DAMAGE } from '../../../src/game/gameObject/spells/Sett_E';
import Sett_Q, { SETT_Q_BONUS, SETT_Q_HITS } from '../../../src/game/gameObject/spells/Sett_Q';
import Sett_R, {
  SETT_R_BLAST,
  SETT_R_SLAM,
  Sett_R_Carry,
} from '../../../src/game/gameObject/spells/Sett_R';
import Sett_W, {
  SETT_W_BASE,
  SETT_W_GRIT_DECAY_MS,
  SETT_W_GRIT_MAX,
  SETT_W_GRIT_RATIO,
  SETT_W_GRIT_SCALE,
} from '../../../src/game/gameObject/spells/Sett_W';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

/**
 * Every unit lives on the +x axis so it stays inside the fixture's 1000-unit
 * quadtree; Sett himself stands at x = 400 so E's rear grab box has room.
 */
function place(game: TestGame, x: number, teamId: string, health = 100): AttackableUnit {
  const unit = createUnit(game, x, teamId);
  unit.collisionRadius = 1;
  unit.stats.speed.baseValue = 10;
  unit.stats.mana.baseValue = 100;
  unit.stats.maxHealth.baseValue = health;
  unit.stats.health.baseValue = health;
  unit.animatedValues.displaySize = 20;
  game.objectManager.addObject(unit);
  return unit;
}

function findCarry(game: TestGame): Sett_R_Carry | null {
  const pending = (game.objectManager as any)._objectToBeAdd as unknown[];
  for (const candidate of pending) {
    if (candidate instanceof Sett_R_Carry) return candidate;
  }
  return null;
}

describe('Sett spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = place(game, 400, 'blue', 1000);
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(700, 0);
    game.objectManager.update();
  });

  afterEach(() => vi.unstubAllGlobals());

  /** A hand-built cast context: createGame's createSpellContext returns undefined. */
  function context(dx: number, dy: number) {
    return {
      spellId: 'test',
      activationId: 'test',
      startedAtMs: 0,
      caster: owner,
      origin: { x: owner.position.x, y: owner.position.y },
      cursorWorld: { x: owner.position.x + dx, y: owner.position.y + dy },
      direction: { x: Math.sign(dx), y: Math.sign(dy) },
    } as any;
  }

  it('banks grit for the damage Sett takes, and stops banking at the cap', () => {
    const w = new Sett_W(owner);
    w.onUpdate(); // installs the damage-taken listener
    const bully = place(game, 900, 'red');

    owner.takeDamage(20, bully);
    expect(w.grit).toBe(20 * SETT_W_GRIT_RATIO);

    owner.takeDamage(200, bully);
    expect(w.grit).toBe(SETT_W_GRIT_MAX);
  });

  it('lets banked grit decay back to nothing over the decay window', () => {
    const w = new Sett_W(owner);
    w.onUpdate();
    owner.takeDamage(20, place(game, 900, 'red'));
    expect(w.grit).toBeGreaterThan(0);

    vi.stubGlobal('deltaTime', 500);
    for (let step = 0; step < SETT_W_GRIT_DECAY_MS / 500; step++) w.onUpdate();
    expect(w.grit).toBe(0);
  });

  it('W spends every point of grit and shields Sett for exactly that much', () => {
    const w = new Sett_W(owner);
    w.onUpdate();
    owner.takeDamage(40, place(game, 900, 'red'));
    expect(w.grit).toBe(20);

    w.onSpellCast(context(300, 0));
    expect(w.grit).toBe(0);
    expect(owner.shieldAmount).toBe(20);
  });

  it('W punches for its base at no grit and for base plus half the grit at the cap', () => {
    const w = new Sett_W(owner);
    w.onUpdate();
    const punched = place(game, 650, 'red', 500); // 250 along the punch: outer band
    const bully = place(game, 900, 'red');
    game.objectManager.update();

    w.onSpellCast(context(300, 0));
    // 500 - 20 = 480
    expect(punched.stats.health.value).toBe(500 - SETT_W_BASE);

    owner.takeDamage(SETT_W_GRIT_MAX / SETT_W_GRIT_RATIO, bully);
    expect(w.grit).toBe(SETT_W_GRIT_MAX);
    w.onSpellCast(context(300, 0));
    // 20 + 0.5 * 40 = 40, so 480 - 40 = 440
    expect(punched.stats.health.value).toBe(
      500 - SETT_W_BASE - (SETT_W_BASE + SETT_W_GRIT_SCALE * SETT_W_GRIT_MAX)
    );
  });

  it("W's core punches through a shield while its outer band is absorbed", () => {
    const w = new Sett_W(owner);
    const core = place(game, 480, 'red'); // 80 along the punch: inside the core
    const band = place(game, 650, 'red'); // 250 along the punch: outer band
    for (const target of [core, band]) {
      const guard = new Shield(4_000, owner, target);
      guard.amount = 50;
      target.addBuff(guard);
    }
    game.objectManager.update();

    w.onSpellCast(context(300, 0));
    expect(core.stats.health.value).toBe(100 - SETT_W_BASE);
    expect(band.stats.health.value).toBe(100);
  });

  it('E hauls both crowds inward and claps them only when both sides caught someone', () => {
    const e = new Sett_E(owner);
    const ahead = place(game, 550, 'red');
    const behind = place(game, 250, 'red');
    game.objectManager.update();
    const startedAt = 150;

    e.onSpellCast(context(300, 0));

    expect(Math.abs(ahead.position.x - owner.position.x)).toBeLessThan(startedAt);
    expect(Math.abs(behind.position.x - owner.position.x)).toBeLessThan(startedAt);
    expect(ahead.hasBuff(Stun)).toBe(true);
    expect(behind.hasBuff(Stun)).toBe(true);
  });

  it('E leaves a one-sided grab unstunned', () => {
    const e = new Sett_E(owner);
    const ahead = place(game, 550, 'red');
    game.objectManager.update();

    e.onSpellCast(context(300, 0));

    expect(ahead.stats.health.value).toBe(100 - SETT_E_DAMAGE);
    expect(ahead.hasBuff(Stun)).toBe(false);
  });

  it('R slams the carried champion and quakes the bystander, never both on one unit', () => {
    const r = new Sett_R(owner);
    const grabbed = place(game, 500, 'red');
    const bystander = place(game, 550, 'red');
    game.objectManager.update();

    r.onSpellCast({ ...context(300, 0), target: grabbed });

    const carry = findCarry(game);
    expect(carry).not.toBeNull();
    for (let step = 0; step < 6 && !carry!.toRemove; step++) carry!.update();

    // 100 - 45 = 55 for the man he threw, 100 - 30 = 70 for the man beside the crater
    expect(grabbed.stats.health.value).toBe(100 - SETT_R_SLAM);
    expect(bystander.stats.health.value).toBe(100 - SETT_R_BLAST);
  });

  it('Q arms exactly two punches and spends them one landed swing at a time', () => {
    const q = new Sett_Q(owner);
    q.onSpellCast();
    expect(q.chargesLeft).toBe(SETT_Q_HITS);

    const victim = place(game, 450, 'red');
    game.objectManager.update();
    const hit = { attacker: owner, victim, damage: 5, ranged: false, crit: false };

    game.eventManager.emit(EventType.ON_ATTACK_HIT, hit);
    expect(victim.stats.health.value).toBe(100 - SETT_Q_BONUS);
    expect(q.chargesLeft).toBe(SETT_Q_HITS - 1);

    game.eventManager.emit(EventType.ON_ATTACK_HIT, hit);
    game.eventManager.emit(EventType.ON_ATTACK_HIT, hit);
    expect(victim.stats.health.value).toBe(100 - SETT_Q_BONUS * SETT_Q_HITS);
    expect(q.chargesLeft).toBe(0);
  });
});
