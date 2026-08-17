import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Pet, {
  PET_LEASH_RANGE,
  PET_SCAN_INTERVAL_MS,
} from '../../../src/game/gameObject/attackableUnits/Pet';
import Shaco_R from '../../../src/game/gameObject/spells/Shaco_R';
import Shaco_W, { ARM_TIME_MS, Shaco_W_Box } from '../../../src/game/gameObject/spells/Shaco_W';
import Jinx_E, {
  CHOMPED_STACK_ID,
  Jinx_E_Chomper,
  LAND_TIME_MS,
  ARM_TIME_MS as CHOMPER_ARM_MS,
} from '../../../src/game/gameObject/spells/Jinx_E';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Annie_R from '../../../src/game/gameObject/spells/Annie_R';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const summon = (overrides: Record<string, unknown> = {}) => {
  const game = createGame();
  const owner = createUnit(game, 0, 'blue');
  const enemy = createUnit(game, 120, 'red');
  enemy.stats.maxHealth.baseValue = 200;
  enemy.stats.health.baseValue = 200;
  game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;

  const pet = new Pet({
    game,
    position: owner.position.copy(),
    teamId: owner.teamId,
    ownerUnit: owner,
    lifeTimeMs: 5000,
    ...overrides,
  } as never);
  return { game, owner, enemy, pet };
};

/**
 * A pet is a unit, not an effect: it can be killed, it fights on its own, and
 * it does not outlive the champion who paid for it.
 */
describe('Pet', () => {
  it('picks its own fight and orders a real basic attack', () => {
    const { enemy, pet } = summon();

    vi.stubGlobal('deltaTime', PET_SCAN_INTERVAL_MS);
    pet.update();
    vi.stubGlobal('deltaTime', 16);

    expect(pet.basicAttack.target).toBe(enemy);
  });

  it('inherits its summoner’s team, so it never turns on them', () => {
    const { owner, pet } = summon();
    expect(pet.teamId).toBe(owner.teamId);
  });

  it('drops the target and comes home once it is past the leash', () => {
    const { pet } = summon();

    pet.position.set(PET_LEASH_RANGE + 200, 0);
    expect(pet.leashed).toBe(true);

    vi.stubGlobal('deltaTime', PET_SCAN_INTERVAL_MS);
    pet.update();
    vi.stubGlobal('deltaTime', 16);

    expect(pet.basicAttack.target).toBeFalsy();
    // Walking back, not teleporting: the destination is short of the owner.
    expect(pet.destination).toBeTruthy();
    expect(pet.destination!.x).toBeLessThan(pet.position.x);
  });

  it('expires on its own clock, once', () => {
    const { pet } = summon({ lifeTimeMs: 1000 });
    const gift = vi.spyOn(pet, 'onExpire');

    vi.stubGlobal('deltaTime', 1200);
    pet.update();
    pet.update();
    vi.stubGlobal('deltaTime', 16);

    expect(pet.toRemove).toBe(true);
    expect(gift).toHaveBeenCalledTimes(1);
  });

  it('dies with its summoner rather than outliving them', () => {
    const { owner, pet } = summon();
    const gift = vi.spyOn(pet, 'onExpire');

    owner.die({ reviveAfter: 5000 });
    pet.update();

    expect(pet.toRemove).toBe(true);
    expect(gift).toHaveBeenCalledOnce();
  });

  it('pays its parting effect when it is killed too, not only when it times out', () => {
    const { pet } = summon();
    const gift = vi.spyOn(pet, 'onExpire');

    pet.die({ reviveAfter: 0 });
    pet.update();

    expect(gift).toHaveBeenCalledOnce();
    expect(pet.toRemove).toBe(true);
  });
});

/**
 * The one caller, so "a pet is a unit" is proved end to end rather than only
 * on the base class. Hallucinate's clone used to be inert art that walked
 * around; it is a pet now, which means it fights and it can be killed.
 */
describe('Shaco R summons a real pet', () => {
  it('puts a fighting, expiring Pet into the world', () => {
    const game = createGame();
    const shaco = createUnit(game, 0, 'blue');
    const enemy = createUnit(game, 150, 'red');
    game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;
    (game as unknown as { worldMouse: unknown }).worldMouse = enemy.position.copy();

    const spell = new Shaco_R(shaco);
    spell.onSpellCast();

    const clone = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Pet => object instanceof Pet
    );
    expect(clone, 'the clone is a Pet, not a SpellObject').toBeTruthy();
    expect(clone!.teamId).toBe(shaco.teamId);
    expect(clone!.targetable).toBe(true); // killable, unlike a shroom

    vi.stubGlobal('deltaTime', PET_SCAN_INTERVAL_MS);
    clone!.update();
    vi.stubGlobal('deltaTime', 16);
    expect(clone!.basicAttack.target).toBe(enemy);
  });
});

/**
 * The rule a trap lives or dies by: while it is hidden it is not a target.
 * `Invisible` alone only hides the body — the box stayed in every
 * `canTakeDamageFromTeam` query, so it could be shot out of the air before it
 * ever triggered, which is no trap at all.
 */
describe('a hidden pet cannot be picked or hit', () => {
  const placeBox = () => {
    const game = createGame();
    const shaco = createUnit(game, 0, 'blue');
    (game as unknown as { worldMouse: unknown }).worldMouse = shaco.position.copy();
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    new Shaco_W(shaco).onSpellCast();
    const box = game.objectManager._objectToBeAdd.find(
      (object: unknown): object is Shaco_W_Box => object instanceof Shaco_W_Box
    );
    return { game, shaco, box: box! };
  };

  const arm = (box: Shaco_W_Box) => {
    vi.stubGlobal('deltaTime', ARM_TIME_MS + 50);
    box.update();
    vi.stubGlobal('deltaTime', 16);
    // Status flags settle on the frame *after* the buff lands: the buff loop
    // that folds `statusFlagsToDisable` into the unit runs at the top of
    // `AttackableUnit.update`, and `setHidden` happens below it. One frame of
    // lag on a trap that arms over a second is not worth special-casing, but
    // it is worth stating.
    box.update();
  };

  it('is targetable while it is still being placed, and not once it hides', () => {
    const { box } = placeBox();

    expect(box.hidden).toBe(false);
    expect(box.targetable).toBe(true);

    arm(box);

    expect(box.hidden).toBe(true);
    expect(box.targetable).toBe(false);
  });

  it('becomes a killable body the moment it pops out', () => {
    const { game, box } = placeBox();
    arm(box);

    const victim = createUnit(game, 10, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    box.update();
    box.update(); // the same one-frame settle, in the other direction

    expect(box.triggered).toBe(true);
    expect(box.hidden).toBe(false);
    expect(box.targetable).toBe(true);
    // ...and the fear went out with the reveal, in the same call.
    expect(victim.buffs.length).toBeGreaterThan(0);
  });
});

/**
 * Read off `docs/abilities/jinx/e.json`, because the first pass was written
 * from memory and got three things wrong: chompers are not stealthed, they do
 * not attack, and a champion can only be caught by one of them.
 */
describe('Flame Chompers match the imported ability data', () => {
  const throwChompers = () => {
    const game = createGame();
    const jinx = createUnit(game, 0, 'blue');
    (game as unknown as { worldMouse: unknown }).worldMouse = jinx.position.copy();
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    new Jinx_E(jinx).onSpellCast();
    const chompers: Jinx_E_Chomper[] = [];
    for (const object of game.objectManager._objectToBeAdd) {
      // `Array.prototype.filter` cannot narrow here — see CLAUDE.md.
      if (object instanceof Jinx_E_Chomper) chompers.push(object);
    }
    return { game, jinx, chompers };
  };

  const arm = (chomper: Jinx_E_Chomper) => {
    vi.stubGlobal('deltaTime', LAND_TIME_MS + CHOMPER_ARM_MS + 50);
    chomper.update();
    vi.stubGlobal('deltaTime', 16);
  };

  it('lands three of them, in plain sight', () => {
    const { chompers } = throwChompers();

    expect(chompers).toHaveLength(3);
    for (const chomper of chompers) {
      arm(chomper);
      chomper.update();
      expect(chomper.hidden, 'chompers are visible, not stealthed').toBe(false);
      expect(chomper.targetable).toBe(true);
    }
  });

  it('bites a champion, and only the first chomper does', () => {
    const { game, jinx, chompers } = throwChompers();
    const victim = new Champion({ game, position: jinx.position.copy(), teamId: 'red' });
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    for (const chomper of chompers) arm(chomper);
    for (const chomper of chompers) chomper.update();

    const roots = victim.buffs.filter(buff => buff.stackId === CHOMPED_STACK_ID);
    expect(roots).toHaveLength(1);
    expect(chompers.filter(chomper => chomper.bitten)).toHaveLength(1);
  });

  it('never orders an attack — a chomper is a trap, not a fighter', () => {
    const { game, jinx, chompers } = throwChompers();
    const victim = new Champion({ game, position: jinx.position.copy(), teamId: 'red' });
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    const chomper = chompers[0];
    arm(chomper);
    chomper.update();

    expect(chomper.basicAttack.target).toBeFalsy();
  });
});

/**
 * The recast half of a summon. Both bugs here were invisible from the outside
 * — the pet takes one step and stops — and neither was in the pet's movement
 * code:
 *
 *   1. `Annie_R` went to COOLDOWN after summoning, and the runtime rejects a
 *      press in COOLDOWN *before* `checkCastCondition` runs. Every R press
 *      while Tibbers was out was thrown away before the move order was read.
 *   2. The pet's own 250ms target scan owns movement while it holds a target
 *      (`BasicAttackController` writes `destination` every frame), so it
 *      overwrote the order as soon as anything was in aggro range.
 */
describe('a summoned pet obeys the recast', () => {
  const summonTibbers = () => {
    const game = createGame();
    const annie = createUnit(game, 0, 'blue');
    game.setPlayer(annie); // the attack path reads `game.player` for its reticle
    (game as unknown as { worldMouse: unknown }).worldMouse = createVector(300, 0);
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    const spell = new Annie_R(annie);
    spell.press({
      spellId: 'annie-r',
      activationId: 'a',
      startedAtMs: 0,
      caster: annie,
      origin: { x: 0, y: 0 },
      cursorWorld: { x: 300, y: 0 },
      direction: { x: 1, y: 0 },
    } as never);
    return { game, annie, spell, tibbers: spell.tibbers! };
  };

  it('leaves the key live while the pet is out, instead of going on cooldown', () => {
    const { spell, tibbers } = summonTibbers();

    expect(tibbers).toBeTruthy();
    expect(spell.currentCooldown).toBe(0);
  });

  it('walks the whole way to the point rather than one step', () => {
    const { tibbers } = summonTibbers();
    const target = createVector(900, 0);

    tibbers.commandTo(target);
    expect(tibbers.underOrders).toBe(true);

    // Many frames of its own update loop: the order has to survive all of them.
    for (let i = 0; i < 20; i++) tibbers.update();

    expect(tibbers.underOrders, 'still walking, order intact').toBe(true);
    expect(tibbers.destination.x).toBeCloseTo(target.x, 5);
  });

  it('keeps the order even with an enemy inside its aggro radius', () => {
    const { game, tibbers } = summonTibbers();
    const enemy = createUnit(game, 40, 'red');
    game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;

    tibbers.commandTo(createVector(900, 0));
    vi.stubGlobal('deltaTime', 300); // past the scan interval
    tibbers.update();
    vi.stubGlobal('deltaTime', 16);

    expect(tibbers.basicAttack.target, 'the order outranks the scan').toBeFalsy();
    expect(tibbers.destination.x).toBeCloseTo(900, 5);
  });

  it('hands control back once it arrives', () => {
    const { game, tibbers } = summonTibbers();
    const enemy = createUnit(game, 40, 'red');
    game.objectManager.queryObjects = vi.fn(() => [enemy]) as never;

    tibbers.commandTo(createVector(900, 0));
    tibbers.position.set(900, 0); // walked there
    vi.stubGlobal('deltaTime', 300);
    tibbers.update();
    tibbers.update();
    vi.stubGlobal('deltaTime', 16);

    expect(tibbers.underOrders).toBe(false);
    expect(tibbers.basicAttack.target).toBe(enemy);
  });
});
