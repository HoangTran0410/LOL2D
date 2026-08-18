import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Airborne from '../../../src/game/gameObject/buffs/Airborne';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Riven_Q, {
  Q_CHARGES,
  Q_DAMAGE,
  Q_DAMAGE_FINAL,
  Q_WINDOW_MS,
} from '../../../src/game/gameObject/spells/Riven_Q';
import Riven_R, {
  R_DAMAGE,
  R_DAMAGE_MAX,
  R_DURATION_MS,
  R_EXECUTE_THRESHOLD,
  Riven_R_WindSlash,
} from '../../../src/game/gameObject/spells/Riven_R';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  // regen would drift the exact-damage assertions below by a fraction per update
  result.stats.healthRegen.baseValue = 0;
  result.animatedValues.displaySize = 20;
  return result;
}

/** A hand-built cast context: createGame's createSpellContext returns undefined. */
function contextFor(caster: AttackableUnit, dx: number, dy: number) {
  return {
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    origin: { x: caster.position.x, y: caster.position.y },
    cursorWorld: { x: caster.position.x + dx, y: caster.position.y + dy },
    direction: { x: Math.sign(dx), y: Math.sign(dy) },
  } as any;
}

function findWindSlash(game: TestGame): Riven_R_WindSlash {
  const pending = game.objectManager._objectToBeAdd as unknown[];
  for (const candidate of pending) {
    if (candidate instanceof Riven_R_WindSlash) return candidate;
  }
  throw new Error('no Riven_R_WindSlash was spawned');
}

describe('Riven', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(400, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  function hasKnockup(victim: AttackableUnit): boolean {
    for (const buff of victim.buffs) {
      if (buff instanceof Airborne) return true;
    }
    return false;
  }

  it('spends three Q charges inside the window, and only the third knocks up', () => {
    const victim = unit(game, 250, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const q = new Riven_Q(owner);
    expect(q.stackCount).toBe(Q_CHARGES);

    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 1);
    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(hasKnockup(victim)).toBe(false);

    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 2);
    expect(victim.stats.health.value).toBe(100 - 2 * Q_DAMAGE);
    expect(hasKnockup(victim)).toBe(false);

    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(0);
    expect(victim.stats.health.value).toBe(100 - 2 * Q_DAMAGE - Q_DAMAGE_FINAL);
    expect(hasKnockup(victim)).toBe(true);
  });

  it('refills the Q charges when the combo window lapses', () => {
    const q = new Riven_Q(owner);
    q.onSpellCast(contextFor(owner, 400, 0));
    expect(q.stackCount).toBe(Q_CHARGES - 1);

    vi.stubGlobal('deltaTime', Q_WINDOW_MS - 1);
    q.onUpdate();
    expect(q.stackCount).toBe(Q_CHARGES - 1);

    vi.stubGlobal('deltaTime', 2);
    q.onUpdate();
    expect(q.stackCount).toBe(Q_CHARGES);
  });

  it('hits every unit in one Q slash exactly once', () => {
    const near = unit(game, 230, 'red');
    near.position.y = 40;
    const far = unit(game, 250, 'red');
    game.objectManager.addObject(near);
    game.objectManager.addObject(far);
    game.objectManager.update();

    new Riven_Q(owner).onSpellCast(contextFor(owner, 400, 0));

    expect(near.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(far.stats.health.value).toBe(100 - Q_DAMAGE);
  });

  it('deals no damage on R first press and fires Wind Slash on the recast', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const r = new Riven_R(owner);
    r.onActivate(contextFor(owner, 400, 0));
    expect(victim.stats.health.value).toBe(100);

    r.onRecast(contextFor(owner, 400, 0));
    findWindSlash(game).update();
    expect(victim.stats.health.value).toBe(100 - R_DAMAGE);
  });

  it('ramps Wind Slash damage from R_DAMAGE at full health to R_DAMAGE_MAX at the threshold', () => {
    // Health ratios are chosen so the expected number is plain arithmetic on the
    // exported constants: full -> 24, three quarters -> the midpoint 36, at and
    // below half -> 48. Nothing here calls the spell's own ramp.
    expect(windSlashDamageAt(100)).toBe(R_DAMAGE);
    expect(windSlashDamageAt(75)).toBe((R_DAMAGE + R_DAMAGE_MAX) / 2);
    expect(windSlashDamageAt(R_EXECUTE_THRESHOLD * 100)).toBe(R_DAMAGE_MAX);
    expect(windSlashDamageAt(R_EXECUTE_THRESHOLD * 75)).toBe(R_DAMAGE_MAX);
  });

  it('ignores an R recast once the ultimate window has run out', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const r = new Riven_R(owner);
    r.onActivate(contextFor(owner, 400, 0));

    vi.stubGlobal('deltaTime', R_DURATION_MS);
    r.onUpdate();

    const pendingBefore = game.objectManager._objectToBeAdd.length;
    r.onRecast(contextFor(owner, 400, 0));
    expect(game.objectManager._objectToBeAdd.length).toBe(pendingBefore);
    expect(victim.stats.health.value).toBe(100);
  });
});

/**
 * One Wind Slash against one victim at `health` out of 100, in its own game so the
 * cone cannot reach the other cases' victims. Returns what actually landed.
 */
function windSlashDamageAt(health: number): number {
  const arena = createGame();
  const riven = unit(arena, 0, 'blue');
  arena.setPlayer(riven);
  const victim = unit(arena, 200, 'red');
  victim.stats.health.baseValue = health;
  arena.objectManager.addObject(victim);
  arena.objectManager.update();

  const before = victim.stats.health.value;
  const r = new Riven_R(riven);
  r.onActivate(contextFor(riven, 400, 0));
  r.onRecast(contextFor(riven, 400, 0));
  findWindSlash(arena).update();
  return before - victim.stats.health.value;
}
