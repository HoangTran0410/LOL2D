import AssetManager from '../../../managers/AssetManager';
import StatusFlags from '../../enums/StatusFlags';
import { SpellForm } from '../../spell/runtime/CancelPolicy';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import CastBar from '../../vfx/CastBar';
import LuxBeamEffect from '../../vfx/LuxBeamEffect';
import Buff from '../Buff';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import TrueSight from '../buffs/TrueSight';
import Flash from './Flash';
import Ghost from './Ghost';
import Heal from './Heal';
import Ignite from './Ignite';
import Lux_E, { Lux_E_Object } from './Lux_E';
import BeamSpellObject, {
  beamBoundingBox,
  type BeamGeometry,
} from '../spellObjects/BeamSpellObject';
import type { Rectangle } from '../../../libs/quadtree';

function hasSpells(unit: AttackableUnit): unit is AttackableUnit & { spells: Spell[] } {
  return 'spells' in unit && Array.isArray(unit.spells);
}

class Lux_R_CastLock extends Buff {
  name = 'Cầu Vồng Tối Thượng';
  stackId = 'lux_r_cast_lock';
  statusFlagsToEnable = StatusFlags.Immovable;
  private readonly disabledBeforeCast = new Map<Spell, boolean>();

  onActivate(): void {
    this.targetUnit.stopMovement?.();
    if (!hasSpells(this.targetUnit)) return;
    for (const spell of this.targetUnit.spells) {
      this.disabledBeforeCast.set(spell, spell.disabled);
      if (!this.isPermitted(spell)) spell.disabled = true;
    }
  }

  onDeactivate(): void {
    for (const [spell, wasDisabled] of this.disabledBeforeCast) spell.disabled = wasDisabled;
    this.disabledBeforeCast.clear();
  }

  private isPermitted(spell: Spell): boolean {
    return (
      spell instanceof Ghost ||
      spell instanceof Heal ||
      spell instanceof Ignite ||
      spell instanceof Flash ||
      (spell instanceof Lux_E && spell.luxEObject?.phase === Lux_E_Object.PHASES.STATIC)
    );
  }
}

// Exported so the suite asserts the beam and reveal wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const CAST_TIME_MS = 1_000;
export const RANGE = 3_400;
export const WIDTH = 200;
export const DAMAGE = 30;
export const REVEAL_DURATION_MS = 1_500;
export const REVEAL_VISION_RADIUS = 150;
export const VISION_LIFETIME_MS = 1_500;
export const MANA_COST = 100;

/**
 * The beam the player actually sees, as a world object rather than as
 * `castSpec.vfx`.
 *
 * `castSpec.vfx` is drawn from `Champion.draw()`, so it inherits the caster's
 * visibility twice over: `ObjectManager.draw()` only reaches objects whose
 * *own* display box is on camera, and `FogOfWar` clears `willDraw` on every
 * unit the player cannot see. A 3400px beam hung off a 40px champion therefore
 * vanished outright whenever Lux was off screen or in fog, while still doing
 * its damage and stamping its reveal on the victim — measured on a real match:
 * `LuxBeamEffect.draw` never ran, the player lost health, and the Lux R icon
 * appeared on their bar with no beam ever painted.
 *
 * Out here it is culled by its own bounds and fog never touches it, which is
 * how every other spell's effect in this game already behaves — they are all
 * world objects, which is why only this one went missing. This is deliberately
 * not a general rule for `castSpec.vfx`: Pantheon Q's and Varus Q's
 * `ChargeRangeTelegraph` show where the *caster* is aiming, and hiding those
 * along with a caster nobody can see is correct. The beam is the effect, not a
 * telegraph of one, and only effects belong in the world.
 */
class Lux_R_Beam extends SpellObject {
  private readonly effect: LuxBeamEffect;

  constructor(
    owner: SpellObject['owner'],
    private readonly geometry: BeamGeometry,
    phase: 'prepare' | 'release',
    getProgress?: () => number
  ) {
    super(owner);
    this.effect = new LuxBeamEffect(geometry, phase, getProgress);
  }

  update(deltaMs = deltaTime): void {
    if (this.dropIfAttachmentLost()) return;
    this.effect.update(deltaMs);
    if (this.effect.complete) this.toRemove = true;
  }

  draw(): void {
    this.effect.draw();
  }

  getDisplayBoundingBox(): Rectangle {
    return beamBoundingBox(this.geometry, this);
  }

  /** Ends the beam now, for a cast that never reached its release. */
  dispose(): void {
    this.effect.dispose();
    this.toRemove = true;
  }
}

class Lux_R_Vision extends SpellObject {
  visionRadius = 250;
  private elapsedMs = 0;

  constructor(owner: SpellObject['owner'], position: { x: number; y: number }) {
    super(owner);
    this.position = createVector(position.x, position.y);
  }

  update(deltaMs = deltaTime): void {
    this.elapsedMs += Math.max(0, deltaMs);
    if (this.elapsedMs >= VISION_LIFETIME_MS) this.toRemove = true;
  }
}

export default class Lux_R extends Spell {
  image = AssetManager.get('spell_lux_r');
  name = 'Cầu Vồng Tối Thượng (Lux_R)';
  description =
    'Niệm <span class="time">1 giây</span> rồi bắn một dải sáng theo hướng đã chốt, gây <span class="damage">30 sát thương</span> lên mọi kẻ địch trúng phải';
  coolDown = 10_000;
  manaCost = MANA_COST;

  private readonly castTimeMs = CAST_TIME_MS;
  private readonly range = RANGE;
  private readonly width = WIDTH;
  private readonly damage = DAMAGE;
  private castElapsedMs = 0;
  private geometry?: BeamGeometry;
  private castLock?: Lux_R_CastLock;
  private prepareBeam?: Lux_R_Beam;
  private sightObjects: Lux_R_Vision[] = [];

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: this.castTimeMs,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      // Once the beam is called down it is in the sky, not in Lux's hands: the
      // cast time is a wind-up on an effect that is already committed, so only
      // her dying takes it back.
      interrupts: SpellForm.INDEPENDENT,
      // The cast bar only, on purpose. It hangs over Lux's head and means
      // nothing without her, so inheriting her visibility is right. The beam
      // does not — see `Lux_R_Beam`.
      vfx: {
        castStart: context => new CastBar(context, () => this.castElapsedMs / this.castTimeMs),
      },
    };
  }

  onCastStart(context: CastContext): void {
    this.castElapsedMs = 0;
    this.geometry = this.beamGeometry(context);
    this.castLock = new Lux_R_CastLock(this.castTimeMs, this.owner, this.owner);
    this.castLock.image = this.image;
    this.owner.addBuff(this.castLock);
    this.addBeamSight(this.geometry);

    this.prepareBeam = new Lux_R_Beam(
      this.owner,
      this.geometry,
      'prepare',
      () => this.castElapsedMs / this.castTimeMs
    );
    // The wind-up is a telegraph of a cast still in progress, so it rides Lux:
    // if she dies the beam never arrives and the lane must go with her. The
    // release flash below does not, because by then the beam is already in the
    // sky and out of her hands.
    this.prepareBeam.attachTo(this.owner);
    this.game.objectManager.addObject(this.prepareBeam);
  }

  onUpdate(): void {
    if (this.state === 'CASTING') this.castElapsedMs += deltaTime;
  }

  onSpellCast(): void {
    if (!this.geometry) return;

    this.endPrepareBeam();
    this.game.objectManager.addObject(new Lux_R_Beam(this.owner, this.geometry, 'release'));

    const beam = new BeamSpellObject(this.owner, this.geometry, {
      candidateFilter: target =>
        typeof target.takeDamage === 'function' &&
        typeof target.addBuff === 'function' &&
        !target.isDead &&
        target.teamId !== this.owner.teamId,
      onHit: target => {
        target.takeDamage(this.damage, this.owner);
        const reveal = new TrueSight(REVEAL_DURATION_MS, this.owner, target);
        reveal.visionRadius = REVEAL_VISION_RADIUS;
        reveal.image = this.image;
        target.addBuff(reveal);
      },
    });
    this.game.objectManager.addObject(beam);
  }

  onCancel(): void {
    this.releaseCastLock();
    this.endPrepareBeam();
    for (const sight of this.sightObjects) sight.toRemove = true;
    this.sightObjects = [];
  }

  onComplete(): void {
    this.releaseCastLock();
    this.endPrepareBeam();
  }

  private beamGeometry(context: CastContext): BeamGeometry {
    return {
      start: context.origin,
      end: {
        x: context.origin.x + context.direction.x * this.range,
        y: context.origin.y + context.direction.y * this.range,
      },
      width: this.width,
    };
  }

  private addBeamSight(geometry: BeamGeometry): void {
    const segments = Math.ceil(this.range / 400);
    this.sightObjects = [];
    for (let index = 0; index <= segments; index++) {
      const ratio = index / segments;
      const sight = new Lux_R_Vision(this.owner, {
        x: geometry.start.x + (geometry.end.x - geometry.start.x) * ratio,
        y: geometry.start.y + (geometry.end.y - geometry.start.y) * ratio,
      });
      this.sightObjects.push(sight);
      this.game.objectManager.addObject(sight);
    }
  }

  private releaseCastLock(): void {
    this.castLock?.deactivateBuff();
    this.castLock = undefined;
  }

  private endPrepareBeam(): void {
    this.prepareBeam?.dispose();
    this.prepareBeam = undefined;
  }
}
