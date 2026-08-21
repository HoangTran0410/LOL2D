/**
 * Veigar's orb, and the third permanent stat farmed off a hit rather than a kill.
 *
 * Same shape as Nasus Q and Cho'Gath R before them: the orb pierces, it stacks
 * per body it passes through, and the stat it stacks is uncapped — so one cast
 * into a wave was five permanent stacks for pressing a key at a crowd. On a
 * kill it is a last hit, which is the ability the wiki describes and a real
 * decision. The mana it grants now comes filled in, exactly as Cho'Gath's
 * Feast heals the max health it just added.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../../src/game/gameObject/attackableUnits/Champion';
import { lethalTargets } from '../../../../src/game/combat/ExecuteTargeting';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../../../game/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import makeVeigar_Q, { makeVeigar_Q_Object, makeLiveStacks } from '../../../../packs/riot/spells/Veigar_Q';
const __api = buildContentApi();
const Veigar_Q = makeVeigar_Q(__api);
const Veigar_Q_Object = makeVeigar_Q_Object(__api);
const liveStacks = makeLiveStacks(__api);

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const veigar = (): Champion => {
  const unit = new Champion({ game, teamId: 'veigar' });
  unit.position.set(0, 0);
  unit.destination.set(0, 0);
  unit.stats.maxMana.baseValue = 500;
  unit.stats.mana.baseValue = 500;
  game.setPlayer(unit);
  return unit;
};

const enemy = (x: number, health: number): Champion => {
  const unit = new Champion({ game, teamId: `enemy-${x}` });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  unit.stats.maxHealth.baseValue = 100;
  unit.stats.health.baseValue = health;
  return unit;
};

/** The orb, configured exactly as `Veigar_Q.onSpellCast` configures it. */
const orb = (owner: Champion): Veigar_Q_Object => {
  const spell = new Veigar_Q(owner);
  const object = new Veigar_Q_Object(owner);
  object.damage = spell.damage;
  object.manaPerStack = spell.manaPerStack;
  object.stackDuration = spell.stackDuration;
  object.maxStacks = spell.maxStacks;
  object.position.set(owner.position.x, owner.position.y);
  return object;
};

describe('Veigar Q stacks on the kill', () => {
  it('passes through a survivor without banking anything', () => {
    const caster = veigar();
    const victim = enemy(120, 100);
    indexObjects(game, [caster, victim]);

    const before = caster.stats.maxMana.value;
    orb(caster).onHit(victim);

    expect(victim.isDead).toBe(false);
    expect(liveStacks(caster)).toHaveLength(0);
    expect(caster.stats.maxMana.value).toBe(before);
  });

  it('banks a stack when the orb finishes someone', () => {
    const caster = veigar();
    const victim = enemy(120, 10);
    indexObjects(game, [caster, victim]);

    const spell = new Veigar_Q(caster);
    const before = caster.stats.maxMana.value;
    orb(caster).onHit(victim);
    caster.updateBuffs();

    expect(victim.isDead).toBe(true);
    expect(liveStacks(caster)).toHaveLength(1);
    expect(caster.stats.maxMana.value).toBe(before + spell.manaPerStack);
  });

  it('gives the new mana rather than only the room for it', () => {
    const caster = veigar();
    const victim = enemy(120, 10);
    indexObjects(game, [caster, victim]);

    const spell = new Veigar_Q(caster);
    // Spent down first, or a full pool would hide the refund behind its own cap.
    caster.stats.mana.baseValue = 200;
    orb(caster).onHit(victim);
    caster.updateBuffs();

    expect(caster.stats.mana.value).toBe(200 + spell.manaPerStack);
  });

  it('never pushes the pool past its own maximum', () => {
    const caster = veigar();
    const victim = enemy(120, 10);
    indexObjects(game, [caster, victim]);

    orb(caster).onHit(victim);
    caster.updateBuffs();

    expect(caster.stats.mana.value).toBe(caster.stats.maxMana.value);
  });

  it('pays once per body the orb actually finishes', () => {
    const caster = veigar();
    const doomed = enemy(120, 10);
    const healthy = enemy(200, 100);
    indexObjects(game, [caster, doomed, healthy]);

    const object = orb(caster);
    object.onHit(doomed);
    object.onHit(healthy);
    caster.updateBuffs();

    expect(liveStacks(caster)).toHaveLength(1);
  });
});

/**
 * The lethal ring, for a spell nobody auto-targets.
 *
 * `ExecuteMarks` promises "press the key and this one dies". For Nasus Q that
 * is unconditional, because the spell picks its own victim. For an orb you aim
 * it is conditional on where the cursor is — and the cursor is known on every
 * frame, so the promise is still exactly true at the moment it is shown. What
 * makes it true is that `executeCandidates` tests the *line the orb would
 * actually fly*, not "everyone within 550px": the difference between those two
 * is the whole feature, and it is what these tests hold.
 */
describe('Veigar Q marks what the current aim would hit', () => {
  /** Veigar at the origin with a body of 40, so every offset below is hand-checkable. */
  const aimingVeigar = (): { caster: Champion; spell: Veigar_Q } => {
    const caster = veigar();
    caster.stats.size.baseValue = 40;
    const spell = new Veigar_Q(caster);
    return { caster, spell };
  };

  /** An enemy of body 40 at (x, y) on `health`. Radius 20 — see `aimingVeigar`. */
  const body = (x: number, y: number, health: number): Champion => {
    const unit = new Champion({ game, teamId: `enemy-${x}-${y}` });
    unit.position.set(x, y);
    unit.destination.set(x, y);
    unit.stats.size.baseValue = 40;
    unit.stats.maxHealth.baseValue = 100;
    unit.stats.health.baseValue = health;
    return unit;
  };

  /** Where the player is pointing. `Spell.aimPoint` reads exactly this. */
  const aimAt = (x: number, y: number): void => {
    (game as unknown as { worldMouse: unknown }).worldMouse = createVector(x, y);
  };

  it('takes an enemy standing on the line', () => {
    const { caster, spell } = aimingVeigar();
    const onPath = body(300, 0, 10);
    indexObjects(game, [caster, onPath]);
    aimAt(500, 0);

    expect(spell.executeCandidates()).toEqual([onPath]);
  });

  it('ignores one that is in range but not in the way', () => {
    const { caster, spell } = aimingVeigar();
    // 300px along the shot, 90px to the side. The orb is 26 across and both
    // bodies are 40, so the line only reaches 20 + 13 = 33px sideways.
    const beside = body(300, 90, 10);
    indexObjects(game, [caster, beside]);
    aimAt(500, 0);

    expect(spell.executeCandidates()).toEqual([]);
  });

  it('takes one that is only just in the way', () => {
    const { caster, spell } = aimingVeigar();
    // 25px to the side, inside the same 33px the previous case is outside of.
    const grazed = body(300, 25, 10);
    indexObjects(game, [caster, grazed]);
    aimAt(500, 0);

    expect(spell.executeCandidates()).toEqual([grazed]);
  });

  it('stops where the orb stops', () => {
    const { caster, spell } = aimingVeigar();
    // The orb always flies its full 550 and no further, wherever the cursor is.
    const tooFar = body(600, 0, 10);
    indexObjects(game, [caster, tooFar]);
    aimAt(5_000, 0);

    expect(spell.executeCandidates()).toEqual([]);
  });

  it('follows the cursor rather than the map', () => {
    const { caster, spell } = aimingVeigar();
    const east = body(300, 0, 10);
    const south = body(0, 300, 10);
    indexObjects(game, [caster, east, south]);

    aimAt(500, 0);
    expect(spell.executeCandidates()).toEqual([east]);

    aimAt(0, 500);
    expect(spell.executeCandidates()).toEqual([south]);
  });

  it('reports every kill one piercing line would make', () => {
    const { caster, spell } = aimingVeigar();
    const first = body(200, 0, 10);
    const second = body(400, 0, 8);
    const survivor = body(300, 0, 100);
    indexObjects(game, [caster, first, second, survivor]);
    aimAt(500, 0);

    expect(spell.executeCandidates()).toHaveLength(3);
    const doomed = lethalTargets(spell);
    expect(doomed).toContain(first);
    expect(doomed).toContain(second);
    expect(doomed).not.toContain(survivor);
  });

  it('quotes the damage the orb actually carries', () => {
    const { caster, spell } = aimingVeigar();
    const target = body(300, 0, 10);
    indexObjects(game, [caster, target]);

    expect(spell.executeDamageAgainst(target)).toBe(spell.damage);
  });
});
