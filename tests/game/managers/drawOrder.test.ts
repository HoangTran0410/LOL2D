import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import { Rectangle } from '../../../src/libs/quadtree';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Pet from '../../../src/game/gameObject/attackableUnits/Pet';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Turret from '../../../src/game/gameObject/structures/Turret';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import TrailSystem from '../../../src/game/gameObject/helpers/TrailSystem';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import CombatText from '../../../src/game/gameObject/helpers/CombatText';
import { GROUND_Z_INDEX } from '../../../src/game/managers/ObjectManager';
import { createGame, stubGameGlobals } from '../fixtures';

/**
 * A `SpellObject` subclass with no zIndex of its own — a stand-in for the
 * huge majority of spell effects (missiles, hit-sparks, auras) that never set
 * one. Proves `classLayerOf`'s walk lands a *subclass* on `SpellObject`'s own
 * registered slot, the same thing that was broken for `AIChampion`/`Pet`.
 */
class UnlabeledSpellEffect extends SpellObject {}

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

/**
 * The full order, not one pair. Both phone reports came out of the same
 * mechanism (`ObjectManager.zIndexOf`/`classLayerOf`) and this is the set the
 * coordinator asked to be proven together: a representative of every layer,
 * including the two classes that used to fall through the cracks —
 * `CombatText` (painted *under* every champion that fell through to the old
 * `DEFAULT_Z_INDEX` of 99) and `Pet` (a `Champion` subclass with no
 * `displayZIndex` of its own, so it *was* one of the champions falling
 * through).
 */
describe('draw order resolves a representative set of classes', () => {
  it('sorts back-to-front by the rule: more important paints later', () => {
    const game = createGame();
    const owner = new Champion({ game });
    game.setPlayer(owner);

    const fountain = new Fountain({
      game,
      preset: { name: 'Blue Fountain', x: 0, y: 0, r: 150, tickInterval: 500 },
    });
    const trail = new TrailSystem({
      isDeadFn: () => false,
      drawFn: () => undefined,
    } as never);
    trail.position.set(0, 0);
    const particle = new ParticleSystem({
      isDeadFn: () => false,
      drawFn: () => undefined,
    });
    particle.position.set(0, 0);
    const groundDecal = new SpellObject(owner);
    groundDecal.zIndex = GROUND_Z_INDEX;
    const monster = new Monster({ game });
    const turret = new Turret({ game, position: createVector(0, 0) });
    const deadPet = new Pet({
      game,
      position: createVector(0, 0),
      teamId: owner.teamId,
      ownerUnit: owner,
      lifeTimeMs: 5_000,
    } as never);
    deadPet.deathData = { reviveAfter: 1_000 };
    const liveChampion = new Champion({ game });
    const spellEffect = new UnlabeledSpellEffect(owner);
    const combatText = new CombatText(owner);

    const order: string[] = [];
    const record = (name: string, object: { draw: () => void }) => {
      object.draw = () => order.push(name);
    };
    record('fountain', fountain);
    record('trail', trail);
    record('particle', particle);
    record('groundDecal', groundDecal);
    record('monster', monster);
    record('turret', turret);
    record('deadPet', deadPet);
    record('liveChampion', liveChampion);
    record('spellEffect', spellEffect);
    record('combatText', combatText);

    // Decoration (particle/trail/combat text) goes in `_decorTree`, matching
    // `isDecoration`; `draw()` walks both, so which tree an object lives in
    // is not itself under test here.
    game.objectManager._objectsTree.insert(fountain.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(groundDecal.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(monster.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(turret.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(deadPet.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(liveChampion.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(spellEffect.getDisplayBoundingBox());
    game.objectManager._decorTree.insert(trail.getDisplayBoundingBox());
    game.objectManager._decorTree.insert(particle.getDisplayBoundingBox());
    game.objectManager._decorTree.insert(combatText.getDisplayBoundingBox());

    game.objectManager.draw();

    const at = (name: string) => order.indexOf(name);
    expect(order).toHaveLength(10);

    // The unambiguous chain: fountain < trail < particle < groundDecal
    // < {monster, turret} < deadPet < liveChampion < spellEffect < combatText.
    expect(at('fountain')).toBeLessThan(at('trail'));
    expect(at('trail')).toBeLessThan(at('particle'));
    expect(at('particle')).toBeLessThan(at('groundDecal'));
    expect(at('groundDecal')).toBeLessThan(at('monster'));
    expect(at('groundDecal')).toBeLessThan(at('turret'));
    // Monster and turret intentionally share OBJECTIVE_Z_INDEX — no order is
    // promised between the two of them, only that both sit in the same band,
    // above ground art and below every champion (dead or alive).
    expect(Math.max(at('monster'), at('turret'))).toBeLessThan(at('deadPet'));
    // The bug: `Pet` (a `Champion` subclass with no `displayZIndex` of its
    // own) used to fall through to `DEFAULT_Z_INDEX` (99) — past
    // `spellEffect` and `combatText` too. Proven here by its position
    // relative to `liveChampion`, not merely "greater than the structures".
    expect(at('deadPet')).toBeLessThan(at('liveChampion'));
    expect(at('liveChampion')).toBeLessThan(at('spellEffect'));
    expect(at('spellEffect')).toBeLessThan(at('combatText'));
  });
});

/**
 * The dead-below-alive rule is a per-object tiebreak, not a layer, so it has
 * to hold regardless of which order the two happened to be inserted (and
 * therefore retrieved from the quadtree) in — insertion order is exactly
 * what the old code was accidentally deciding by. Built both ways round.
 */
describe('dead sorts below alive, independent of insertion order', () => {
  const run = (insertDeadFirst: boolean) => {
    const game = createGame();
    const dead = new Champion({ game });
    dead.position.set(0, 0);
    dead.deathData = { reviveAfter: 1_000 };
    const alive = new Champion({ game });
    alive.position.set(10, 10);
    game.setPlayer(alive);

    const order: string[] = [];
    dead.draw = () => order.push('dead');
    alive.draw = () => order.push('alive');

    const first = insertDeadFirst ? dead : alive;
    const second = insertDeadFirst ? alive : dead;
    game.objectManager._objectsTree.insert(first.getDisplayBoundingBox());
    game.objectManager._objectsTree.insert(second.getDisplayBoundingBox());

    game.objectManager.draw();
    return order;
  };

  it('dead paints under alive when the dead one was inserted first', () => {
    expect(run(true)).toEqual(['dead', 'alive']);
  });

  it('dead paints under alive when the dead one was inserted last', () => {
    expect(run(false)).toEqual(['dead', 'alive']);
  });
});
