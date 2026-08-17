import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));

import Lux_R, {
  CAST_TIME_MS,
  DAMAGE,
  MANA_COST,
  RANGE,
  REVEAL_DURATION_MS,
  REVEAL_VISION_RADIUS,
  VISION_LIFETIME_MS,
  WIDTH,
} from '../../../src/game/gameObject/spells/Lux_R';
import Flash from '../../../src/game/gameObject/spells/Flash';
import Ghost from '../../../src/game/gameObject/spells/Ghost';
import Heal from '../../../src/game/gameObject/spells/Heal';
import Ignite from '../../../src/game/gameObject/spells/Ignite';
import Lux_E, { Lux_E_Object } from '../../../src/game/gameObject/spells/Lux_E';
import Spell from '../../../src/game/gameObject/Spell';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import CastBar from '../../../src/game/vfx/CastBar';
import LuxBeamEffect from '../../../src/game/vfx/LuxBeamEffect';
import { Rectangle } from '../../../src/libs/quadtree';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy() { return new TestVector(this.x, this.y); }
  add(x: number, y: number) { this.x += x; this.y += y; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  setMag(length: number) {
    const magnitude = this.mag();
    if (magnitude > 0) {
      this.x = (this.x / magnitude) * length;
      this.y = (this.y / magnitude) * length;
    }
    return this;
  }
  static add(first: TestVector, second: TestVector) {
    return new TestVector(first.x + second.x, first.y + second.y);
  }
  static sub(first: TestVector, second: TestVector) {
    return new TestVector(first.x - second.x, first.y - second.y);
  }
}

interface TestTarget {
  position: TestVector;
  collisionRadius: number;
  teamId: string;
  isDead: boolean;
  takeDamage: (damage: number, source: unknown) => void;
  addBuff: (buff: unknown) => void;
}

const context = (caster: unknown): CastContext => Object.freeze({
  spellId: 'lux-r',
  activationId: 'cast',
  startedAtMs: 0,
  caster,
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 100, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

interface WorldObject {
  visibleToPlayerTeam?: boolean;
  toRemove?: boolean;
  getDisplayBoundingBox?: () => Rectangle;
  draw?: () => void;
}

/**
 * The world draw pass, as `ObjectManager.draw()` runs it: every live object
 * whose *own* display bounding box is on camera and which the fog has not
 * hidden. The caster is deliberately not in this list — she is off camera, and
 * `FogOfWar` clears `visibleToPlayerTeam` on every unit the player cannot see —
 * because
 * that is the frame the beam has to survive.
 */
const drawWorld = (objects: readonly WorldObject[], camera: Rectangle): void => {
  for (const object of objects) {
    if (object.toRemove || object.visibleToPlayerTeam === false) continue;
    if (!object.getDisplayBoundingBox?.().intersect(camera)) continue;
    object.draw?.();
  }
};

/** An aim that landed exactly on the caster: no distance, so no direction. */
const degenerateContext = (caster: unknown): CastContext => Object.freeze({
  spellId: 'lux-r',
  activationId: 'cast',
  startedAtMs: 0,
  caster,
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 0, y: 0 }),
  direction: Object.freeze({ x: 0, y: 0 }),
});

const beamOwner = (added: unknown[]) => ({
  game: {
    eventManager: { emit: vi.fn() },
    objectManager: {
      addObject: (object: unknown) => added.push(object),
      queryObjects: () => [],
    },
  },
  position: new TestVector(0, 0),
  destination: new TestVector(0, 0),
  teamId: 'blue',
  isDead: false,
  canCast: true,
  stopMovement: vi.fn(),
  addBuff: (buff: { activateBuff(): void }) => buff.activateBuff(),
  stats: { mana: { value: 200 }, health: { value: 100 } },
});

describe('Lux R', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('p5', { Vector: TestVector });
    const p5Globals =
      ['push', 'pop', 'noFill', 'stroke', 'strokeWeight', 'noStroke', 'fill', 'rect'];
    for (const name of p5Globals) {
      vi.stubGlobal(name, vi.fn());
    }
    vi.stubGlobal('line', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('grows its prepare lane and keeps a layered release flash alive for 450ms', () => {
    const geometry = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 20 };
    let progress = 0.25;
    const prepare = new LuxBeamEffect(geometry, 'prepare', () => progress);

    prepare.draw();
    const earlyWidth = Math.max(...vi.mocked(strokeWeight).mock.calls.map(([weight]) => weight));
    vi.mocked(strokeWeight).mockClear();
    progress = 1;
    prepare.draw();
    const fullWidth = Math.max(...vi.mocked(strokeWeight).mock.calls.map(([weight]) => weight));
    expect(fullWidth).toBeGreaterThan(earlyWidth);

    vi.mocked(line).mockClear();
    const release = new LuxBeamEffect(geometry, 'release');
    release.draw();
    expect(line).toHaveBeenCalledTimes(8);
    release.update(0);
    release.update(449);
    expect(release.complete).toBe(false);
    release.update(1);
    expect(release.complete).toBe(true);
  });

  it('expires a release flash even when it is never drawn', () => {
    const release = new LuxBeamEffect(
      { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 20 },
      'release'
    );

    release.update(0);
    release.update(450);

    expect(release.complete).toBe(true);
  });

  it('draws its beam from the world, so a caster nobody can see still shows one', () => {
    const beamDraw = vi.spyOn(LuxBeamEffect.prototype, 'draw');
    const added: WorldObject[] = [];
    const owner = beamOwner(added);
    const spell = new Lux_R(owner);

    spell.press(context(owner));

    // A screen at the far end of the beam: Lux stands at the origin, RANGE
    // away, so she is off camera and in fog, and nothing on her body draws.
    const camera = new Rectangle({ x: RANGE - 1_000, y: -450, w: 1_280, h: 900 });

    beamDraw.mockClear();
    drawWorld(added, camera);
    expect(beamDraw).toHaveBeenCalled();

    // and it is the world that draws it, not the champion: hanging it off both
    // would paint the lane twice for anyone who can see her.
    beamDraw.mockClear();
    spell.drawVfx();
    expect(beamDraw).not.toHaveBeenCalled();

    vi.stubGlobal('deltaTime', CAST_TIME_MS);
    spell.update();

    beamDraw.mockClear();
    drawWorld(added, camera);
    expect(beamDraw).toHaveBeenCalled();
  });

  it('still fires a full beam when the aim landed on Lux herself', () => {
    const firedFrom = (destination: TestVector) => {
      const added: unknown[] = [];
      const owner = beamOwner(added);
      owner.destination = destination;
      const spell = new Lux_R(owner);

      spell.press(degenerateContext(owner));
      vi.stubGlobal('deltaTime', CAST_TIME_MS);
      spell.update();

      const beam = added.find(
        (object): object is BeamSpellObject => object instanceof BeamSpellObject
      );
      if (!beam) throw new Error('Lux R must create its beam.');
      return beam.geometry;
    };

    // Walking south, so that is where the beam goes: `Game.facing()` already
    // states the rule this follows — a direction is never (0,0).
    expect(firedFrom(new TestVector(0, 200)).end).toEqual({ x: 0, y: RANGE });
    // Standing perfectly still, with nothing left to point at: it still has to
    // be a beam, because a start equal to its end draws nothing at all and
    // hit-tests as a dot on Lux's own feet.
    expect(firedFrom(new TestVector(0, 0)).end).toEqual({ x: RANGE, y: 0 });
  });

  it('snapshots its beam and deals damage only after cast completion', () => {
    const disposeCastBar = vi.spyOn(CastBar.prototype, 'dispose');
    const releaseDraw = vi.spyOn(LuxBeamEffect.prototype, 'draw');
    const added: unknown[] = [];
    const targetBuffs: unknown[] = [];
    const ownerBuffs: Array<{ toRemove: boolean; statusFlagsToEnable: number }> = [];
    const target: TestTarget = {
      position: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      isDead: false,
      takeDamage: vi.fn(),
      addBuff: buff => targetBuffs.push(buff),
    };
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: unknown) => added.push(object),
          queryObjects: () => [target],
        },
      },
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement: vi.fn(),
      addBuff: (buff: { activateBuff(): void; toRemove: boolean; statusFlagsToEnable: number }) => {
        ownerBuffs.push(buff);
        buff.activateBuff();
      },
      stats: { mana: { value: 200 }, health: { value: 100 } },
    };
    const spell = new Lux_R(owner);

    spell.press(context(owner));

    expect(spell.state).toBe('CASTING');
    expect(owner.stats.mana.value).toBe(200 - MANA_COST);
    expect(owner.stopMovement).toHaveBeenCalledOnce();
    expect(ownerBuffs).toHaveLength(1);
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Stunned).toBeFalsy();
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Immovable).toBeTruthy();
    expect(target.takeDamage).not.toHaveBeenCalled();
    expect(spell.cancel('MOVE')).toBe(false);
    expect(spell.cancel('STUN')).toBe(false);

    owner.position.x = 50;
    vi.stubGlobal('deltaTime', CAST_TIME_MS);
    spell.update();
    spell.drawVfx();

    expect(disposeCastBar).toHaveBeenCalledOnce();
    // The release flash lives in the world now, not on the champion, so it is
    // the world pass that paints it — see the beam-visibility test above.
    drawWorld(added as WorldObject[], new Rectangle({ x: 0, y: -450, w: 1_280, h: 900 }));
    expect(releaseDraw).toHaveBeenCalled();

    const beam = added.find(
      (object): object is BeamSpellObject => object instanceof BeamSpellObject
    );
    if (!beam) throw new Error('Lux R must create its beam.');
    expect(added.filter(object => object instanceof BeamSpellObject)).toHaveLength(1);
    expect(beam.geometry).toEqual({
      start: { x: 0, y: 0 },
      end: { x: RANGE, y: 0 },
      width: WIDTH,
    });
    expect(target.takeDamage).not.toHaveBeenCalled();

    beam.update();

    expect(target.takeDamage).toHaveBeenCalledWith(DAMAGE, owner);
    expect(targetBuffs).toHaveLength(1);
    expect(targetBuffs[0]).toMatchObject({ duration: REVEAL_DURATION_MS, visionRadius: REVEAL_VISION_RADIUS });
    expect(ownerBuffs[0].toRemove).toBe(true);
  });

  it('locks only prohibited actions and restores their prior state exactly once', () => {
    class ProhibitedSpell extends Spell {
      targetingMode = 'DIRECTION' as const;
    }

    const added: unknown[] = [];
    const ownerBuffs: Array<{
      activateBuff(): void;
      deactivateBuff(): void;
      statusFlagsToEnable: number;
    }> = [];
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: unknown) => added.push(object),
          queryObjects: () => [],
        },
      },
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement: vi.fn(),
      addBuff: (buff: typeof ownerBuffs[number]) => {
        ownerBuffs.push(buff);
        buff.activateBuff();
      },
      stats: { mana: { value: 500 }, health: { value: 100 } },
      spells: [] as Spell[],
    };
    const spell = new Lux_R(owner);
    const ghost = new Ghost(owner);
    const heal = new Heal(owner);
    const ignite = new Ignite(owner);
    const flash = new Flash(owner);
    const recast = new Lux_E(owner);
    recast.luxEObject = { phase: Lux_E_Object.PHASES.STATIC } as Lux_E_Object;
    const freshLuxE = new Lux_E(owner);
    const prohibited = new ProhibitedSpell(owner);
    const alreadyDisabled = new ProhibitedSpell(owner);
    alreadyDisabled.disabled = true;
    owner.spells = [spell, ghost, heal, ignite, flash, recast, freshLuxE, prohibited, alreadyDisabled];

    spell.press(context(owner));

    expect(owner.canCast).toBe(true);
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Stunned).toBeFalsy();
    expect(ownerBuffs[0].statusFlagsToEnable & StatusFlags.Immovable).toBeTruthy();
    expect([ghost, heal, ignite, flash, recast].every(candidate => !candidate.disabled)).toBe(true);
    expect(freshLuxE.disabled).toBe(true);
    expect(prohibited.castCancelCheck()).toBe(true);

    ownerBuffs[0].deactivateBuff();
    ownerBuffs[0].deactivateBuff();

    expect(prohibited.disabled).toBe(false);
    expect(alreadyDisabled.disabled).toBe(true);
  });

  it('grants sight along the frozen beam during the cast and briefly after release', () => {
    const added: Array<{
      position?: { x: number; y: number };
      visionRadius?: number;
      teamId?: string;
      toRemove?: boolean;
      update?: (deltaMs?: number) => void;
    }> = [];
    const ownerBuffs: Array<{ activateBuff(): void }> = [];
    const owner = {
      game: {
        eventManager: { emit: vi.fn() },
        objectManager: {
          addObject: (object: typeof added[number]) => added.push(object),
          queryObjects: () => [],
        },
      },
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      canCast: true,
      stopMovement: vi.fn(),
      addBuff: (buff: { activateBuff(): void }) => {
        ownerBuffs.push(buff);
        buff.activateBuff();
      },
      stats: { mana: { value: 200 }, health: { value: 100 } },
    };
    const spell = new Lux_R(owner);

    spell.press(context(owner));

    const sight = added.filter(object => (object.visionRadius ?? 0) > 0);
    expect(sight.length).toBeGreaterThan(1);
    expect(sight.every(object => object.teamId === 'blue')).toBe(true);
    expect(Math.min(...sight.map(object => object.position!.x))).toBe(0);
    expect(Math.max(...sight.map(object => object.position!.x))).toBe(RANGE);

    sight.forEach(object => object.update?.(VISION_LIFETIME_MS - 1));
    expect(sight.every(object => object.toRemove === false)).toBe(true);
    sight.forEach(object => object.update?.(1));
    expect(sight.every(object => object.toRemove === true)).toBe(true);
  });
});
