/**
 * The scheduler that lets a camp do something other than swing.
 *
 * Deliberately generic rather than "Baron's kit": Baron is the first camp to
 * need one, but a dragon or a buff camp declaring its own abilities must not
 * mean rewriting this. A preset lists `abilities`; the camp tracks a cooldown
 * per entry and casts at most one per frame, on the same terms a champion
 * casts on — it must be able to act (`canCast`), have something to cast at, and
 * be close enough for the ability to mean anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, { type MonsterAbility } from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

const CAMP = { x: 1_000, y: 1_000, r: 100 };

let game: TestGame;

/** Records every cast instead of doing anything, so order and count are visible. */
const spyAbility = (overrides: Partial<MonsterAbility> = {}) => {
  const casts: Champion[] = [];
  const ability: MonsterAbility = {
    name: overrides.name ?? 'Probe',
    cooldownMs: overrides.cooldownMs ?? 1_000,
    range: overrides.range,
    cast: overrides.cast ?? ((_monster, target) => void casts.push(target)),
  };
  return { ability, casts };
};

const makeCamp = (abilities: MonsterAbility[], overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: TEST_AVATAR_KEY,
      camp: { ...CAMP },
      speed: 0,
      size: 100,
      attackRange: 400,
      reviveTime: 100,
      health: 1_000,
      abilities,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

/** A camp already locked onto a champion standing well inside its reach. */
const engaged = (abilities: MonsterAbility[], overrides: Record<string, unknown> = {}) => {
  const camp = makeCamp(abilities, overrides);
  const champion = new Champion({ game, teamId: 'other' });
  champion.position.set(CAMP.x + 60, CAMP.y);
  indexObjects(game, [camp, champion]);
  camp.aggroOn(champion);
  return { camp, champion };
};

describe('a camp casts the abilities its preset declares', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('casts at the champion it has locked', () => {
    const { ability, casts } = spyAbility();
    const { camp, champion } = engaged([ability]);

    camp.updateAttack();

    expect(casts).toEqual([champion]);
  });

  it('holds the ability on its cooldown afterwards', () => {
    const { ability, casts } = spyAbility({ cooldownMs: 1_000 });
    const { camp } = engaged([ability]);

    camp.updateAttack();
    camp.update();
    camp.updateAttack();

    expect(casts).toHaveLength(1);
  });

  it('casts it again once that cooldown is spent', () => {
    const { ability, casts } = spyAbility({ cooldownMs: 100 });
    const { camp } = engaged([ability]);

    camp.updateAttack();
    for (let i = 0; i < 10; i++) camp.update();
    camp.updateAttack();

    expect(casts).toHaveLength(2);
  });

  it('casts at most one ability per frame, even with several ready', () => {
    const first = spyAbility({ name: 'First' });
    const second = spyAbility({ name: 'Second' });
    const { camp } = engaged([first.ability, second.ability]);

    camp.updateAttack();

    expect(first.casts).toHaveLength(1);
    expect(second.casts).toHaveLength(0);
  });

  it('gets to the second one on the next frame', () => {
    const first = spyAbility({ name: 'First', cooldownMs: 10_000 });
    const second = spyAbility({ name: 'Second', cooldownMs: 10_000 });
    const { camp } = engaged([first.ability, second.ability]);

    camp.updateAttack();
    camp.update();
    camp.updateAttack();

    expect(first.casts).toHaveLength(1);
    expect(second.casts).toHaveLength(1);
  });

  it('does not swing in the same frame it casts', () => {
    const { ability } = spyAbility();
    const { camp, champion } = engaged([ability]);
    const health = champion.stats.health.value;

    camp.updateAttack();

    expect(champion.stats.health.value).toBe(health);
  });

  it('skips an ability whose own range the target is outside of', () => {
    const near = spyAbility({ name: 'Near', range: 100 });
    const far = spyAbility({ name: 'Far', range: 400 });
    const { camp, champion } = engaged([near.ability, far.ability]);
    champion.position.set(CAMP.x + 300, CAMP.y);

    camp.updateAttack();

    expect(near.casts).toHaveLength(0);
    expect(far.casts).toHaveLength(1);
  });

  it('casts nothing while it is stunned', () => {
    const { ability, casts } = spyAbility();
    const { camp, champion } = engaged([ability]);

    camp.addBuff(new Stun(2_000, champion, camp));
    camp.updateBuffs();
    camp.updateAttack();

    expect(casts).toEqual([]);
  });

  it('casts nothing with no target locked', () => {
    const { ability, casts } = spyAbility();
    const camp = makeCamp([ability]);
    indexObjects(game, [camp]);

    camp.update();

    expect(casts).toEqual([]);
  });

  it('leaves a camp with no abilities exactly as it was', () => {
    const { camp, champion } = engaged([]);
    const health = champion.stats.health.value;
    camp._attackCooldown = 0;

    camp.updateAttack();

    expect(champion.stats.health.value).toBe(health - camp.damage);
  });
});
