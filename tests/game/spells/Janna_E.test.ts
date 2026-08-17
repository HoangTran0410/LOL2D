import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Janna_E, {
  COOLDOWN_MS,
  Janna_E_Shell,
  notifyJannaControlLanded,
  REFUND_RATIO,
  RANGE,
  BONUS_ATTACK_DAMAGE,
  SHIELD_AMOUNT,
  SHIELD_DURATION_MS,
} from '../../../src/game/gameObject/spells/Janna_E';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function champion(game: TestGame, x: number, teamId: string): Champion {
  const result = new Champion({ game, position: createVector(x, 0), teamId });
  result.collisionRadius = 1;
  // generous pool: several tests cast this spell more than once off one unit
  result.stats.mana.baseValue = 10_000;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 55;
  return result;
}

const castContext = (owner: AttackableUnit, target?: unknown): CastContext =>
  Object.freeze({
    spellId: 'janna-e',
    activationId: 'activation',
    startedAtMs: 1,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
    ...(target === undefined ? {} : { target }),
  });

function tick(objects: { update(): void }[], stepMs: number, totalMs: number): void {
  vi.stubGlobal('deltaTime', stepMs);
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    for (const object of objects) object.update();
  }
}

describe('Janna E', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('constrain', (v: number, lo: number, hi: number) =>
      Math.min(Math.max(v, lo), hi)
    );
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);
    vi.stubGlobal('PI', Math.PI);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an enemy target and an out-of-range ally', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    game.setPlayer(owner);
    const enemy = champion(game, 100, 'red');
    const outOfRange = champion(game, RANGE + 1, 'blue');

    expect(new Janna_E(owner).press(castContext(owner, enemy))).toBe(false);
    expect(new Janna_E(owner).press(castContext(owner, outOfRange))).toBe(false);
  });

  it('shields an ally other than the caster, and can target the caster too', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 100, 'blue');
    const spell = new Janna_E(owner);

    expect(spell.press(castContext(owner, ally))).toBe(true);

    const shield = ally.buffs.find((buff): buff is Shield => buff instanceof Shield);
    expect(shield).toMatchObject({ amount: SHIELD_AMOUNT, duration: SHIELD_DURATION_MS });
    expect(owner.buffs.find((buff): buff is Shield => buff instanceof Shield)).toBeUndefined();

    expect(new Janna_E(owner).press(castContext(owner, owner))).toBe(true);
    expect(owner.buffs.find((buff): buff is Shield => buff instanceof Shield)).toBeDefined();
  });

  // The other half of the Wiki's payload. It had no stat to land on when this
  // spell was written and was dropped; basic attacks exist now, so it lands on
  // the same clock as the shield.
  it('gives the shielded ally bonus attack damage for as long as the shield holds', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 100, 'blue');
    const before = ally.stats.attackDamage.value;

    expect(new Janna_E(owner).press(castContext(owner, ally))).toBe(true);
    ally.updateBuffs();

    const might = ally.buffs.find(
      (buff): buff is StatAmp => buff instanceof StatAmp && buff.stackId === 'janna_e_might'
    );
    expect(might?.duration).toBe(SHIELD_DURATION_MS);
    expect(ally.stats.attackDamage.value).toBe(before + BONUS_ATTACK_DAMAGE);
  });

  it('attaches the shield shell to the shielded ally, not the caster', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 100, 'blue');
    const spell = new Janna_E(owner);
    spell.press(castContext(owner, ally));

    const shell = game.objectManager._objectToBeAdd.find(
      (object): object is Janna_E_Shell => object instanceof Janna_E_Shell
    );
    if (!shell) throw new Error('Janna E must create its shield shell.');
    expect(shell.target).toBe(ally);
    expect(shell.owner).toBe(owner);

    ally.position.set(250, 40);
    shell.update();
    expect(shell.position).toMatchObject({ x: 250, y: 40 });
  });

  it('drops the shell once the shield expires, and does not come back if the ally later dies', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 100, 'blue');
    const spell = new Janna_E(owner);
    spell.press(castContext(owner, ally));

    const shield = ally.buffs.find((buff): buff is Shield => buff instanceof Shield)!;
    const shell = game.objectManager._objectToBeAdd.find(
      (object): object is Janna_E_Shell => object instanceof Janna_E_Shell
    )!;

    tick([shield, shell], 500, SHIELD_DURATION_MS - 500);
    expect(shell.toRemove).toBe(false);

    tick([shield, shell], 500, 1_000);
    expect(shield.toRemove).toBe(true);
    expect(shell.toRemove).toBe(true);

    ally.die({ reviveAfter: 5_000 });
    ally.respawn();
    tick([shell], 100, 500);
    expect(shell.toRemove).toBe(true);
  });

  it('draws a procedural wind shell rather than blitting the ability icon', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 100, 'blue');
    const shell = new Janna_E_Shell(owner, ally);
    const spies = { image: vi.fn(), circle: vi.fn(), arc: vi.fn() };
    for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
    for (const name of [
      'push',
      'pop',
      'translate',
      'fill',
      'stroke',
      'noFill',
      'noStroke',
      'strokeWeight',
    ]) {
      vi.stubGlobal(name, vi.fn());
    }
    shell.age = 500;

    shell.draw();

    expect(spies.image).not.toHaveBeenCalled();
    expect(spies.arc).toHaveBeenCalled();
    expect(spies.circle).toHaveBeenCalled();
  });

  it('sizes its display bounding box around the shielded ally, not the caster', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 300, 'blue');
    const shell = new Janna_E_Shell(owner, ally);

    const box = shell.getDisplayBoundingBox();
    const expectedRadius = ally.animatedValues.displaySize / 2 + 30;

    expect(box).toMatchObject({
      x: ally.position.x - expectedRadius,
      y: ally.position.y - expectedRadius,
      w: expectedRadius * 2,
      h: expectedRadius * 2,
    });
  });

  it('refunds a fifth of the remaining cooldown exactly once per cooldown window', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const enemy = champion(game, 10, 'red');
    const spell = new Janna_E(owner);
    spell.currentCooldown = COOLDOWN_MS;

    notifyJannaControlLanded(owner, enemy); // no-op: owner has no .spells wired yet
    owner.spells = [spell];

    notifyJannaControlLanded(owner, enemy);
    expect(spell.currentCooldown).toBe(COOLDOWN_MS - COOLDOWN_MS * REFUND_RATIO);

    const afterFirstRefund = spell.currentCooldown;
    notifyJannaControlLanded(owner, enemy); // second CC landing this window: no further refund
    expect(spell.currentCooldown).toBe(afterFirstRefund);
  });

  it('re-arms the refund every time the spell is cast again', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const enemy = champion(game, 10, 'red');
    const ally = champion(game, 100, 'blue');
    const spell = new Janna_E(owner);
    owner.spells = [spell];
    spell.press(castContext(owner, ally));

    notifyJannaControlLanded(owner, enemy);
    const cooldownAfterFirstRefund = spell.currentCooldown;
    expect(cooldownAfterFirstRefund).toBeLessThan(COOLDOWN_MS);

    notifyJannaControlLanded(owner, enemy); // still armed-off within the same window
    expect(spell.currentCooldown).toBe(cooldownAfterFirstRefund);

    spell.currentCooldown = 0;
    spell.press(castContext(owner, ally));
    spell.currentCooldown = COOLDOWN_MS;
    notifyJannaControlLanded(owner, enemy);
    expect(spell.currentCooldown).toBeLessThan(COOLDOWN_MS);
  });

  it('does not refund when there is no cooldown to refund, or against allies', () => {
    const game = createGame();
    const owner = champion(game, 0, 'blue');
    const ally = champion(game, 100, 'blue');
    const spell = new Janna_E(owner);
    owner.spells = [spell];
    spell.currentCooldown = 0;

    notifyJannaControlLanded(owner, ally);
    expect(spell.currentCooldown).toBe(0);
  });
});
