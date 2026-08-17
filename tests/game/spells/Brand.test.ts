import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Brand_Q, {
  ABLAZE_STACK_ID,
  Brand_Q_Missile,
  DAMAGE as Q_DAMAGE,
  STUN_DURATION_MS,
  applyAblaze,
  isAblaze,
} from '../../../src/game/gameObject/spells/Brand_Q';
import Brand_W, {
  ABLAZE_DAMAGE_BONUS,
  Brand_W_Object,
  DAMAGE as W_DAMAGE,
  ERUPT_DELAY_MS,
} from '../../../src/game/gameObject/spells/Brand_W';
import Brand_E, {
  ABLAZE_SPREAD_RADIUS,
  DAMAGE as E_DAMAGE,
  SPREAD_RADIUS,
} from '../../../src/game/gameObject/spells/Brand_E';
import Brand_R, {
  BOUNCE_COUNT,
  Brand_R_Fireball,
  DAMAGE_PER_BOUNCE,
} from '../../../src/game/gameObject/spells/Brand_R';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 5;
  result.stats.mana.baseValue = 300;
  result.stats.health.baseValue = 200;
  result.stats.maxHealth.baseValue = 200;
  result.animatedValues.displaySize = 55;
  return result;
}

const castContext = (
  owner: AttackableUnit,
  cursorWorld: { x: number; y: number },
  target?: unknown
): CastContext =>
  Object.freeze({
    spellId: 'brand',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 1, y: 0 }),
    ...(target === undefined ? {} : { target }),
  });

describe('Brand', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Q ignites a clean target and stuns one that was already burning', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = unit(game, 300, 'red');
    game.objectManager.objects.push(owner, enemy);
    game.objectManager.update();

    const spell = new Brand_Q(owner);
    expect(spell.press(castContext(owner, { x: 300, y: 0 }))).toBe(true);
    spell.update();

    const missile = game.objectManager._objectToBeAdd.find(
      (object): object is Brand_Q_Missile => object instanceof Brand_Q_Missile
    );
    if (!missile) throw new Error('Brand Q must create its missile.');

    missile.onHit(enemy);
    expect(enemy.stats.health.value).toBe(200 - Q_DAMAGE);
    expect(isAblaze(enemy)).toBe(true);
    expect(enemy.buffs.some(buff => buff instanceof Stun)).toBe(false);

    missile.onHit(enemy);
    const stun = enemy.buffs.find(buff => buff instanceof Stun);
    expect(stun?.duration).toBe(STUN_DURATION_MS);
  });

  it('W deals nothing until the pillar erupts, and hits a burning target harder', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const clean = unit(game, 300, 'red');
    const burning = unit(game, 320, 'red');
    applyAblaze(owner, burning, null);
    game.objectManager.objects.push(owner, clean, burning);
    game.objectManager.update();

    const spell = new Brand_W(owner);
    expect(spell.press(castContext(owner, { x: 310, y: 0 }))).toBe(true);
    spell.update();

    const pillar = game.objectManager._objectToBeAdd.find(
      (object): object is Brand_W_Object => object instanceof Brand_W_Object
    );
    if (!pillar) throw new Error('Brand W must create its pillar.');

    const cleanDamage = vi.spyOn(clean, 'takeDamage');
    const burningDamage = vi.spyOn(burning, 'takeDamage');

    expect(ERUPT_DELAY_MS).toBeGreaterThan(500);
    pillar.update();
    pillar.update(); // 500ms in, still telegraphing
    expect(cleanDamage).not.toHaveBeenCalled();

    pillar.update(); // 750ms in, past the delay
    expect(pillar.hasErupted).toBe(true);
    expect(cleanDamage).toHaveBeenCalledWith(W_DAMAGE, owner);
    expect(burningDamage).toHaveBeenCalledWith(W_DAMAGE * (1 + ABLAZE_DAMAGE_BONUS), owner);
  });

  it('E only reaches the far bystander once the primary target is already burning', () => {
    const game = createGame();
    const owner = unit(game, -300, 'blue');
    game.setPlayer(owner);
    const primary = unit(game, 0, 'red');
    const bystander = unit(game, SPREAD_RADIUS + 50, 'red');
    expect(SPREAD_RADIUS + 50).toBeLessThan(ABLAZE_SPREAD_RADIUS);
    game.objectManager.objects.push(owner, primary, bystander);
    game.objectManager.update();

    const bystanderDamage = vi.spyOn(bystander, 'takeDamage');

    const first = new Brand_E(owner);
    expect(first.press(castContext(owner, primary.position, primary))).toBe(true);
    first.update();
    expect(primary.stats.health.value).toBe(200 - E_DAMAGE);
    expect(bystanderDamage).not.toHaveBeenCalled();

    // the first cast left the primary Ablaze, so the second spreads twice as far
    expect(isAblaze(primary)).toBe(true);
    const second = new Brand_E(owner);
    expect(second.press(castContext(owner, primary.position, primary))).toBe(true);
    second.update();
    expect(bystanderDamage).toHaveBeenCalledWith(E_DAMAGE, owner);
  });

  it('R hits for every bounce it owes, slowing only once the victim is burning', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = unit(game, 120, 'red');
    game.objectManager.objects.push(owner, enemy);
    game.objectManager.update();

    const spell = new Brand_R(owner);
    expect(spell.press(castContext(owner, enemy.position, enemy))).toBe(true);
    spell.update();

    const fireball = game.objectManager._objectToBeAdd.find(
      (object): object is Brand_R_Fireball => object instanceof Brand_R_Fireball
    );
    if (!fireball) throw new Error('Brand R must create its fireball.');

    const damage = vi.spyOn(enemy, 'takeDamage');
    for (let i = 0; i < 400 && !fireball.toRemove; i++) {
      fireball.update();
      if (damage.mock.calls.length === 1) {
        // the first bounce is what set them alight, so nothing is slowed yet
        expect(enemy.buffs.some(buff => buff instanceof Slow)).toBe(false);
      }
    }

    expect(fireball.toRemove).toBe(true);
    expect(damage.mock.calls).toHaveLength(BOUNCE_COUNT);
    expect(damage).toHaveBeenCalledWith(DAMAGE_PER_BOUNCE, owner);
    expect(enemy.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(enemy.buffs.some(buff => buff.stackId === ABLAZE_STACK_ID)).toBe(true);
  });
});
