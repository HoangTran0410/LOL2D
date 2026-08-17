import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Caitlyn_Q, {
  CAITLYN_Q_DAMAGE,
  CAITLYN_Q_REDUCED_DAMAGE,
  Caitlyn_Q_Object,
} from '../../../src/game/gameObject/spells/Caitlyn_Q';
import Caitlyn_W, {
  CAITLYN_W_DAMAGE,
  CAITLYN_W_MAX_TRAPS,
  CAITLYN_W_PLACE_RANGE,
  CAITLYN_W_REVEAL_STACK_ID,
  CAITLYN_W_ROOT_MS,
  Caitlyn_W_Trap,
} from '../../../src/game/gameObject/spells/Caitlyn_W';
import Caitlyn_E, {
  CAITLYN_E_DAMAGE,
  CAITLYN_E_RECOIL_DISTANCE,
  CAITLYN_E_SLOW_PERCENT,
  Caitlyn_E_Net,
} from '../../../src/game/gameObject/spells/Caitlyn_E';
import Caitlyn_R, {
  CAITLYN_R_CANCEL_COOLDOWN_MS,
  CAITLYN_R_CHANNEL_MS,
} from '../../../src/game/gameObject/spells/Caitlyn_R';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Root from '../../../src/game/gameObject/buffs/Root';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
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
  result.stats.mana.baseValue = 200;
  result.stats.maxMana.baseValue = 200;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

describe('Caitlyn', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('W places a trap inside its range and never keeps more than the cap', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(2000, 0);
    const owner = unit(game, 0, 'blue');
    const w = new Caitlyn_W(owner);

    for (let i = 0; i < CAITLYN_W_MAX_TRAPS + 1; i++) w.onSpellCast();

    const traps = game.objectManager._objectToBeAdd.filter(
      object => object instanceof Caitlyn_W_Trap
    ) as Caitlyn_W_Trap[];
    expect(traps.length).toBe(CAITLYN_W_MAX_TRAPS + 1);
    expect(traps[0].position.dist(owner.position)).toBeCloseTo(CAITLYN_W_PLACE_RANGE, 3);
    // The first one placed is the one pushed off the end.
    expect(traps[0].toRemove).toBe(true);
    expect(w.stackCount).toBe(CAITLYN_W_MAX_TRAPS);
  });

  it('W roots, reveals and damages exactly once when it springs', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const victim = unit(game, 100, 'red');

    const trap = new Caitlyn_W_Trap(owner);
    trap.position = victim.position.copy();
    trap.spring(victim);

    expect(victim.buffs.some(buff => buff instanceof Root)).toBe(true);
    expect(victim.buffs.find(buff => buff instanceof Root)!.duration).toBe(CAITLYN_W_ROOT_MS);
    expect(victim.buffs.some(buff => buff.stackId === CAITLYN_W_REVEAL_STACK_ID)).toBe(true);
    expect(victim.stats.health.value).toBe(100 - CAITLYN_W_DAMAGE);

    trap.spring(victim);
    expect(victim.stats.health.value).toBe(100 - CAITLYN_W_DAMAGE);
  });

  it('Q falls off after the first body, but never against a trapped target', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const first = unit(game, 100, 'red');
    const second = unit(game, 200, 'red');
    const trapped = unit(game, 300, 'red');

    const shot = new Caitlyn_Q_Object(owner);
    shot.onHit(first);
    shot.onHit(second);
    expect(first.stats.health.value).toBe(100 - CAITLYN_Q_DAMAGE);
    expect(second.stats.health.value).toBe(100 - CAITLYN_Q_REDUCED_DAMAGE);

    new Caitlyn_W_Trap(owner).spring(trapped);
    const trappedHealth = trapped.stats.health.value;
    shot.onHit(trapped);
    expect(trapped.stats.health.value).toBe(trappedHealth - CAITLYN_Q_DAMAGE);

    const q = new Caitlyn_Q(owner);
    expect(q.castSpec.targeting).toBe('DIRECTION');
    // Reading the cooldown builds the runtime, which validates the spec — a
    // refund named for an interrupt this form never fires throws right here.
    expect(q.currentCooldown).toBe(0);
  });

  it('E throws the net forward and kicks Caitlyn the other way', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(1000, 0);
    const owner = unit(game, 0, 'blue');
    const victim = unit(game, 200, 'red');

    new Caitlyn_E(owner).onSpellCast();

    const net = game.objectManager._objectToBeAdd.find(
      object => object instanceof Caitlyn_E_Net
    ) as Caitlyn_E_Net;
    expect(net).toBeDefined();
    expect(net.destination.x).toBeGreaterThan(owner.position.x);

    const recoil = owner.buffs.find(buff => buff instanceof Dash) as Dash;
    expect(recoil.dashDestination!.x).toBeLessThan(owner.position.x);
    expect(recoil.dashDestination!.dist(owner.position)).toBeCloseTo(CAITLYN_E_RECOIL_DISTANCE, 3);

    net.onHit(victim);
    expect(victim.stats.health.value).toBe(100 - CAITLYN_E_DAMAGE);
    const slow = victim.buffs.find(buff => buff instanceof Slow) as Slow;
    expect(slow.percent).toBe(CAITLYN_E_SLOW_PERCENT);
  });

  it('R channels before it fires, and a broken channel costs the reduced cooldown', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const r = new Caitlyn_R(owner);

    expect(r.castSpec.castTimeMs).toBe(CAITLYN_R_CHANNEL_MS);
    expect(r.currentCooldown).toBe(0);

    r.onCancel();
    expect(r.currentCooldown).toBe(CAITLYN_R_CANCEL_COOLDOWN_MS);
  });
});
