import AssetManager from '../../../managers/AssetManager';
import StatusFlags from '../../enums/StatusFlags';
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
import BeamSpellObject, { type BeamGeometry } from '../spellObjects/BeamSpellObject';

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
  private sightObjects: Lux_R_Vision[] = [];

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: this.castTimeMs,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      interrupts: {
        death: true,
        stun: false,
        silence: false,
        displacement: false,
        move: false,
      },
      vfx: {
        castStart: context => new CastBar(context, () => this.castElapsedMs / this.castTimeMs),
        castLoop: context => new LuxBeamEffect(
          this.beamGeometry(context),
          'prepare',
          () => this.castElapsedMs / this.castTimeMs
        ),
        release: context => new LuxBeamEffect(this.beamGeometry(context), 'release'),
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
  }

  onUpdate(): void {
    if (this.state === 'CASTING') this.castElapsedMs += deltaTime;
  }

  onSpellCast(): void {
    if (!this.geometry) return;

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
    for (const sight of this.sightObjects) sight.toRemove = true;
    this.sightObjects = [];
  }

  onComplete(): void {
    this.releaseCastLock();
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
}
