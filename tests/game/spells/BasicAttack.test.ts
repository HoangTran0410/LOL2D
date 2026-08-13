import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import BasicAttack from '../../../src/game/gameObject/spells/BasicAttack';
import Spell from '../../../src/game/gameObject/Spell';
import Champion, {
  type ChampionAttackTuning,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import SpellInputController from '../../../src/game/spell/input/SpellInputController';
import { HotKeys, SpellHotKeys } from '../../../src/game/constants';
import { CURSOR_ACQUISITION_RADIUS } from '../../../src/game/combat/AttackTargeting';
import { BasicAttackBolt } from '../../../src/game/combat/BasicAttack';
import Disarm from '../../../src/game/gameObject/buffs/Disarm';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import basicAttackSpellSource from '../../../src/game/gameObject/spells/BasicAttack.ts?raw';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext, Vec2 } from '../../../src/game/spell/runtime/types';

/** A spell that is not the basic attack, cheap enough to always go off. */
class Probe extends Spell {
  name = 'Probe';
  coolDown = 0;
  manaCost = 0;
}

const RANGED: ChampionAttackTuning = { damage: 16, attacksPerSecond: 0.8, range: 300 };

let teamCounter = 0;
const nextTeam = () => `team-${(teamCounter += 1)}`;

function champion(game: TestGame, x: number, y = 0, teamId = nextTeam()): Champion {
  return new Champion({
    game,
    position: createVector(x, y),
    teamId,
    preset: { attack: RANGED },
  });
}

const contextAt = (caster: AttackableUnit, cursor: Vec2): CastContext =>
  Object.freeze({
    spellId: 'basic-attack',
    activationId: 'activation',
    startedAtMs: 0,
    caster,
    origin: Object.freeze({ x: caster.position.x, y: caster.position.y }),
    cursorWorld: Object.freeze({ x: cursor.x, y: cursor.y }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

/**
 * A player champion wired the way Game wires the real one: the same
 * SpellInputController over the same SpellHotKeys, so a test presses a key
 * rather than calling into the spell.
 */
function harness(spells: Array<new (owner: Champion) => Spell> = [BasicAttack, Probe]) {
  const game = createGame();
  const player = new Champion({
    game,
    position: createVector(0, 0),
    teamId: nextTeam(),
    preset: { attack: RANGED, spells },
  });
  game.setPlayer(player);

  const cursor = { x: 0, y: 0 };
  const input = new SpellInputController({
    keyBindings: SpellHotKeys,
    getSpell: slot => player.spells[slot],
    createContext: (_spell, slot) =>
      player.spells[slot] ? contextAt(player, cursor) : undefined,
  });

  return {
    game,
    player,
    world(units: AttackableUnit[]) {
      indexObjects(game, [player, ...units]);
      return units;
    },
    press(key: number, at?: Vec2) {
      if (at) {
        cursor.x = at.x;
        cursor.y = at.y;
      }
      input.keyDown(key, false);
      input.keyUp(key);
    },
  };
}

/** Objects the controller handed to the manager but that have not been added yet. */
const pending = (game: TestGame) => game.objectManager._objectToBeAdd;

describe('BasicAttack, the ability in the A slot', () => {
  beforeEach(() => {
    stubGameGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ------------------------------------------------------------- acquisition

  it('orders the enemy nearest the cursor, not the one nearest the champion', () => {
    const world = harness();
    // `near` is closer to the champion, `far` is closer to the cursor
    const near = champion(world.game, 120);
    const far = champion(world.game, 600);
    world.world([near, far]);

    world.press(HotKeys.A, { x: 620, y: 0 });

    expect(world.player.basicAttack.target).toBe(far);
  });

  it('reaches only as far as the acquisition radius around the cursor', () => {
    const world = harness();
    const inside = champion(world.game, CURSOR_ACQUISITION_RADIUS - 10);
    world.world([inside]);

    world.press(HotKeys.A, { x: 0, y: 0 });
    expect(world.player.basicAttack.target).toBe(inside);

    world.player.basicAttack.clear();
    inside.position.set(CURSOR_ACQUISITION_RADIUS + 40, 0);
    indexObjects(world.game, [world.player, inside]);

    world.press(HotKeys.A, { x: 0, y: 0 });
    expect(world.player.basicAttack.target).toBeNull();
  });

  it('ignores allies, corpses, untargetable bodies and anything the fog is hiding', () => {
    const world = harness();
    const ally = champion(world.game, 60, 0, world.player.teamId);
    const corpse = champion(world.game, 70);
    corpse.die({ reviveAfter: 1_000 });
    const untargetable = champion(world.game, 80);
    untargetable.setStatus(StatusFlags.Targetable, false);
    const hidden = champion(world.game, 90);
    hidden.willDraw = false;
    const real = champion(world.game, 200);
    world.world([ally, corpse, untargetable, hidden, real]);

    world.press(HotKeys.A, { x: 75, y: 0 });

    // every closer body is disqualified, so the order lands on the one enemy
    // that is alive, hostile, targetable and visible
    expect(world.player.basicAttack.target).toBe(real);
  });

  it('is a no-op when there is nobody near the cursor', () => {
    const world = harness();
    world.world([champion(world.game, 3_000)]);

    expect(() => world.press(HotKeys.A, { x: 0, y: 0 })).not.toThrow();
    expect(world.player.basicAttack.target).toBeNull();
    // and the press cost nothing, so the key is not locked out
    expect(world.player.spells[0].state).toBe('READY');
    expect(world.player.spells[0].currentCooldown).toBe(0);
  });

  it('leaves a standing order alone when a later press finds nothing', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);

    world.press(HotKeys.A, { x: 200, y: 0 });
    expect(world.player.basicAttack.target).toBe(enemy);

    world.press(HotKeys.A, { x: 4_000, y: 4_000 });
    expect(world.player.basicAttack.target).toBe(enemy);
  });

  // ---------------------------------------------------------------- stickiness

  it('keeps the order, the chase and the swings while the target walks away', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);
    world.press(HotKeys.A, { x: 200, y: 0 });

    world.player.basicAttack.update();
    expect(pending(world.game)[0]).toBeInstanceOf(BasicAttackBolt);

    // the target walks out of reach; nobody presses anything again
    enemy.position.set(450, 0);
    world.player.basicAttack.update();

    expect(world.player.basicAttack.target).toBe(enemy);
    expect(world.player.destination).toMatchObject({ x: 450, y: 0 });

    // and once the chase closes the gap it swings again on the interval
    world.player.position.set(430, 0);
    vi.stubGlobal('deltaTime', 2_000);
    world.player.basicAttack.update();
    expect(pending(world.game)).toHaveLength(2);
  });

  // ------------------------------------------------------------------ cancels

  it('drops the order on a stun and on a disarm', () => {
    for (const Control of [Stun, Disarm]) {
      const world = harness();
      const enemy = champion(world.game, 200);
      world.world([enemy]);
      world.press(HotKeys.A, { x: 200, y: 0 });
      expect(world.player.basicAttack.target, Control.name).toBe(enemy);

      world.player.addBuff(new Control(1_000, world.player, world.player));
      world.player.updateBuffs();
      world.player.basicAttack.update();

      expect(world.player.basicAttack.target, Control.name).toBeNull();
      expect(world.player.basicAttack.lastEnd, Control.name).toBe('DISABLED');
    }
  });

  it('refuses a fresh press while the champion is under crowd control', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);

    world.player.addBuff(new Stun(1_000, world.player, world.player));
    world.player.updateBuffs();
    world.press(HotKeys.A, { x: 200, y: 0 });

    expect(world.player.basicAttack.target).toBeNull();
  });

  it('drops the order when the champion casts another ability', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);
    world.press(HotKeys.A, { x: 200, y: 0 });
    expect(world.player.basicAttack.target).toBe(enemy);

    world.press(HotKeys.Q, { x: 200, y: 0 });

    expect(world.player.basicAttack.target).toBeNull();
    expect(world.player.basicAttack.lastEnd).toBe('CLEARED');
  });

  it('does not drop the order when the ability pressed is the basic attack', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);

    world.press(HotKeys.A, { x: 200, y: 0 });
    world.press(HotKeys.A, { x: 200, y: 0 });

    expect(world.player.basicAttack.target).toBe(enemy);
  });

  it('still cancels on a move order', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);
    world.press(HotKeys.A, { x: 200, y: 0 });

    world.player.orderMove(900, 900);

    expect(world.player.basicAttack.target).toBeNull();
    expect(world.player.destination).toMatchObject({ x: 900, y: 900 });
  });

  // --------------------------------------------------- one place damage happens

  it('issues an order and nothing else, so a landing still goes through landBasicAttack', () => {
    // Every on-hit passive hangs off ON_ATTACK_HIT, which only landBasicAttack
    // emits and only the two delivery objects call. A spell that applied its own
    // damage "to keep it simple" would silently switch Teemo's poison off for
    // exactly the input this feature adds, with nothing failing to say so.
    expect(basicAttackSpellSource).not.toMatch(/\.takeDamage\(|landBasicAttack\(|\.emit\(/);
  });

  // ------------------------------------------------------------- the two paths

  it('leaves the right click path working, whatever is in slot 0', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);

    // A gone: slot 0 swapped for an ordinary ability, exactly what the picker does
    world.player.replaceSpell(0, new Probe(world.player));
    world.press(HotKeys.A, { x: 200, y: 0 });
    expect(world.player.basicAttack.target).toBeNull();

    // right click is untouched — Game calls this after finding the body
    world.player.orderAttack(enemy);
    expect(world.player.basicAttack.target).toBe(enemy);
  });

  it('comes back when the picker puts it in a slot again', () => {
    const world = harness([Probe, Probe]);
    const enemy = champion(world.game, 200);
    world.world([enemy]);

    world.press(HotKeys.A, { x: 200, y: 0 });
    expect(world.player.basicAttack.target).toBeNull();

    world.player.replaceSpell(0, new BasicAttack(world.player));
    world.press(HotKeys.A, { x: 200, y: 0 });
    expect(world.player.basicAttack.target).toBe(enemy);
  });

  // --------------------------------------------------------------- the HUD read

  it('reports the live swing timer rather than a cooldown of its own', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);
    const spell = world.player.spells[0];

    world.press(HotKeys.A, { x: 200, y: 0 });
    world.player.update();

    // the swing timer the controller is really running, and the interval it is
    // counting down from, both read off stats.attackSpeed
    expect(world.player.basicAttack.cooldownMs).toBeGreaterThan(0);
    expect(spell.currentCooldown).toBe(world.player.basicAttack.cooldownMs);
    expect(spell.coolDown).toBeCloseTo(1_000 / RANGED.attacksPerSecond);

    // an attack speed buff shortens both in the same frame
    world.player.stats.attackSpeed.percentBonus = 1;
    world.player.update();
    expect(spell.coolDown).toBeCloseTo(1_000 / (RANGED.attacksPerSecond * 2));
  });

  it('reads as a rhythm rather than a lockout, so the HUD leaves the icon alone', () => {
    expect(new BasicAttack(null as never).cooldownLocksOut).toBe(false);
    // and the flag is opt-in: an ordinary ability still greys out and counts down
    expect(new Probe(null as never).cooldownLocksOut).toBe(true);
  });

  it('never hands a swing back when a refused cast resets spell cooldowns', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);
    world.press(HotKeys.A, { x: 200, y: 0 });
    world.player.basicAttack.update();

    const remaining = world.player.basicAttack.cooldownMs;
    expect(remaining).toBeGreaterThan(0);
    world.player.spells[0].resetCoolDown();

    expect(world.player.basicAttack.cooldownMs).toBe(remaining);
  });

  // ------------------------------------------------------------- the picker

  it('builds with no owner, the way the spell picker builds every spell', () => {
    const preview = new BasicAttack(null as never);

    expect(preview.name).toBeTruthy();
    expect(preview.description).toContain(String(CURSOR_ACQUISITION_RADIUS));
    expect(preview.manaCost).toBe(0);
    expect(preview.coolDown).toBeGreaterThan(0);
    expect(preview.currentCooldown).toBe(0);
    expect(() => preview.onUpdate()).not.toThrow();
    expect(() => preview.drawPreview()).not.toThrow();
  });

  it('survives being put in every slot at once, the way One For All does', () => {
    const world = harness();
    const enemy = champion(world.game, 200);
    world.world([enemy]);

    world.player.replaceSpells(
      SpellHotKeys.map(() => new BasicAttack(world.player))
    );

    expect(() => {
      for (const key of SpellHotKeys) world.press(key, { x: 200, y: 0 });
      world.player.update();
    }).not.toThrow();

    // seven presses, one standing order, one swing timer
    expect(world.player.basicAttack.target).toBe(enemy);
    expect(pending(world.game)).toHaveLength(1);
  });
});
