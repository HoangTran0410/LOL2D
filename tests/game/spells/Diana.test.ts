import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Diana_Q, {
  MOONLIGHT_MS,
  Moonlight,
  Q_DAMAGE,
  Q_SWEEP_MS,
  moonlightOn,
} from '../../../src/game/gameObject/spells/Diana_Q';
import Diana_W, {
  W_SHIELD,
  W_SPHERES,
  W_SPHERE_DAMAGE,
} from '../../../src/game/gameObject/spells/Diana_W';
import Diana_E, { E_DAMAGE } from '../../../src/game/gameObject/spells/Diana_E';
import Diana_R, { R_DAMAGE, R_PULL_MS } from '../../../src/game/gameObject/spells/Diana_R';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

/** Diana stands well inside the fixture's 1000x1000 map so no victim falls out of the tree. */
const HOME_X = 500;
const HOME_Y = 500;

describe('Diana spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  function unitAt(x: number, y: number, teamId: string): AttackableUnit {
    const result = createUnit(game, x, teamId);
    result.position.set(x, y);
    result.destination.set(x, y);
    result.collisionRadius = 1;
    result.stats.speed.baseValue = 0;
    result.stats.mana.baseValue = 500;
    result.stats.health.baseValue = 100;
    result.stats.maxHealth.baseValue = 100;
    result.animatedValues.displaySize = 20;
    return result;
  }

  function enemyAt(x: number, y: number): AttackableUnit {
    const victim = unitAt(x, y, 'red');
    game.objectManager.addObject(victim);
    return victim;
  }

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

  function pendingObject<T>(index = 0): T {
    return game.objectManager._objectToBeAdd[index] as unknown as T;
  }

  /** The engine's arrival callback, invoked the way Dash itself would invoke it. */
  function landTheDash(): void {
    for (let i = owner.buffs.length - 1; i >= 0; i--) {
      const buff = owner.buffs[i] as any;
      if (buff instanceof Dash) {
        buff.onReachedDestination();
        return;
      }
    }
    throw new Error('Diana_E applied no Dash buff');
  }

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unitAt(HOME_X, HOME_Y, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(HOME_X + 300, HOME_Y);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Q curves along a crescent arc: the arc path and destination are cut, the back is not', () => {
    // Enemies along destination, crescent arc, and behind the cast.
    const ahead = enemyAt(HOME_X + 250, HOME_Y);
    const flank = enemyAt(HOME_X + 150, HOME_Y + 110);
    const behind = enemyAt(HOME_X - 250, HOME_Y);
    game.objectManager.update();

    new Diana_Q(owner).onSpellCast(context(300, 0));
    for (let i = 0; i < 6; i++) game.objectManager.update();

    expect(ahead.tally.damageTaken).toBe(Q_DAMAGE);
    expect(flank.tally.damageTaken).toBe(Q_DAMAGE);
    expect(behind.tally.damageTaken).toBe(0);

    // Turn around and that same untouched unit, at that same distance, is cut. Without this
    // the miss above would also pass if the query simply never reached behind her.
    new Diana_Q(owner).onSpellCast(context(-300, 0));
    for (let i = 0; i < 6; i++) game.objectManager.update();

    expect(behind.tally.damageTaken).toBe(Q_DAMAGE);
    expect(ahead.tally.damageTaken).toBe(Q_DAMAGE);
  });

  it('Q marks what it cuts and never cuts the same unit twice in one sweep', () => {
    const victim = enemyAt(HOME_X + 250, HOME_Y);
    game.objectManager.update();

    new Diana_Q(owner).onSpellCast(context(300, 0));
    const sweep = pendingObject<{ update(): void }>();
    for (let i = 0; i < Math.ceil(Q_SWEEP_MS / 250) + 2; i++) sweep.update();

    expect(victim.tally.damageTaken).toBe(Q_DAMAGE);
    expect(moonlightOn(victim)).not.toBeNull();
  });

  it('Moonlight fades on its own clock', () => {
    const victim = enemyAt(HOME_X, HOME_Y + 250);
    game.objectManager.update();
    victim.addBuff(new Moonlight(MOONLIGHT_MS, owner, victim));

    vi.stubGlobal('deltaTime', MOONLIGHT_MS / 4);
    for (let i = 0; i < 3; i++) game.objectManager.update();
    expect(moonlightOn(victim)).not.toBeNull();

    for (let i = 0; i < 3; i++) game.objectManager.update();
    expect(moonlightOn(victim)).toBeNull();
  });

  it('E into a marked target eats the mark and resets its own cooldown', () => {
    const victim = enemyAt(HOME_X + 250, HOME_Y);
    game.objectManager.update();
    victim.addBuff(new Moonlight(MOONLIGHT_MS, owner, victim));

    const e = new Diana_E(owner);
    const reset = vi.spyOn(e, 'resetCoolDown');
    e.onSpellCast(context(250, 0, victim));
    landTheDash();

    expect(victim.tally.damageTaken).toBe(E_DAMAGE);
    expect(moonlightOn(victim)).toBeNull();
    expect(e.lastDiveConsumedMoonlight).toBe(true);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('E into an unmarked target still lands, but the cooldown keeps running', () => {
    const victim = enemyAt(HOME_X + 250, HOME_Y);
    game.objectManager.update();

    const e = new Diana_E(owner);
    const reset = vi.spyOn(e, 'resetCoolDown');
    e.onSpellCast(context(250, 0, victim));
    landTheDash();

    expect(victim.tally.damageTaken).toBe(E_DAMAGE);
    expect(e.lastDiveConsumedMoonlight).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('E refuses to cast on self or an ally and never deals self-damage', () => {
    const e = new Diana_E(owner);
    const ally = unitAt(HOME_X + 100, HOME_Y, 'blue');
    game.objectManager.addObject(ally);
    game.objectManager.update();

    // Direct cast targeting self or ally is rejected by onSpellCast and press
    e.onSpellCast(context(0, 0, owner));
    expect(owner.tally.damageTaken).toBe(0);
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);

    e.onSpellCast(context(100, 0, ally));
    expect(ally.tally.damageTaken).toBe(0);
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);

    // Press with empty ground or no enemy returns false and does not dash or damage
    const pressedSelf = e.press(context(0, 0));
    expect(pressedSelf).toBe(false);
    expect(owner.tally.damageTaken).toBe(0);
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);
    expect(e.currentCooldown).toBe(0);
    expect(e.state).toBe('READY');
  });

  it('W refreshes the shield once all three spheres are spent, and not before', () => {
    const victim = enemyAt(HOME_X + 90, HOME_Y);
    game.objectManager.update();

    new Diana_W(owner).onSpellCast();
    const orbit = pendingObject<any>();
    expect(orbit.liveSpheres.length).toBe(W_SPHERES);

    orbit.detonate(orbit.spheres[0], victim.position.copy());
    orbit.detonate(orbit.spheres[1], victim.position.copy());
    expect(orbit.liveSpheres.length).toBe(1);
    expect(orbit.shieldRefreshCount).toBe(0);

    orbit.detonate(orbit.spheres[2], victim.position.copy());
    expect(orbit.liveSpheres.length).toBe(0);
    expect(orbit.shieldRefreshCount).toBe(1);
    expect(owner.shieldAmount).toBeGreaterThanOrEqual(W_SHIELD);
    expect(victim.tally.damageTaken).toBe(W_SPHERES * W_SPHERE_DAMAGE);
  });

  it('R damages the gathered crowd at the end of the pull, not at cast', () => {
    const victim = enemyAt(HOME_X + 250, HOME_Y);
    game.objectManager.update();
    const startDistance = victim.position.dist(owner.position);

    new Diana_R(owner).onSpellCast();
    const gather = pendingObject<{ update(): void }>();
    expect(victim.tally.damageTaken).toBe(0);

    gather.update();
    expect(victim.tally.damageTaken).toBe(0);

    for (let i = 0; i < Math.ceil(R_PULL_MS / 250) + 1; i++) gather.update();
    expect(victim.tally.damageTaken).toBe(R_DAMAGE);
    expect(victim.position.dist(owner.position)).toBeLessThan(startDistance);
  });
});
