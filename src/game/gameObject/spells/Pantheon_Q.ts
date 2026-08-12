import AssetManager from '../../../managers/AssetManager';
import type { CancelReason, CastContext, CastSpec, Vec2 } from '../../spell/runtime/types';
import BeamSpellObject, { type BeamTarget } from '../spellObjects/BeamSpellObject';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import CastBar from '../../vfx/CastBar';

const HOLD_THRESHOLD_MS = 350;
const MAX_CHARGE_MS = 4_000;
const RANGE = 1_200;

interface SpearTarget extends BeamTarget {
  readonly stats: { health: { value: number }; maxHealth: { value: number } };
  takeDamage(damage: number, owner: unknown): void;
}

export default class Pantheon_Q extends Spell {
  image = AssetManager.getAsset('spell_pantheon_q');
  name = 'Ngọn Giá Sao Băng (Pantheon_Q)';
  description = 'Thả sớm để đâm giáo, hoặc giữ để ném một ngọn giáo xuyên.';
  coolDown = 8_000;
  manaCost = 25;

  private chargeMs = 0;
  private chargeSlow?: Slow;
  private wasThrust = false;

  protected get castSpec(): CastSpec {
    return {
      activation: 'TAP_OR_HOLD',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: MAX_CHARGE_MS, releaseAtMax: false },
      resource: { commitAt: 'start', refundOn: ['MAX_DURATION', 'SILENCE', 'STUN'] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      interrupts: { move: false },
      vfx: { castLoop: context => new CastBar(context, () => this.chargeMs / MAX_CHARGE_MS) },
    };
  }

  onCastStart(_context: CastContext): void {
    this.chargeMs = 0;
    this.wasThrust = false;
    this.chargeSlow = new Slow(MAX_CHARGE_MS, this.owner, this.owner);
    this.chargeSlow.percent = 0.1;
    this.chargeSlow.stackId = 'pantheon_q_charge_slow';
    this.owner.addBuff(this.chargeSlow);
  }

  onChargeUpdate(_context: CastContext, elapsedMs: number): void {
    this.chargeMs = elapsedMs;
  }

  onRelease(context: CastContext): void {
    this.removeChargeSlow();
    const start = { x: this.owner.position.x, y: this.owner.position.y };
    const direction = this.directionTo(context, start);
    if (this.chargeMs <= HOLD_THRESHOLD_MS) {
      this.createThrust(start, direction);
      this.wasThrust = true;
      return;
    }

    const spear = new Pantheon_Q_Spear(this.owner);
    spear.destination = createVector(start.x + direction.x * RANGE, start.y + direction.y * RANGE);
    this.game.objectManager.addObject(spear);
  }

  onCancel(_context: CastContext, reason: CancelReason): void {
    this.removeChargeSlow();
    if (reason === 'MAX_DURATION' || reason === 'SILENCE' || reason === 'STUN') {
      this.owner.stats.mana.value -= this.manaCost / 2;
    }
  }

  onComplete(_context: CastContext): void {
    if (this.wasThrust) this.currentCooldown = this.coolDown * 0.4;
  }

  private createThrust(start: Vec2, direction: Vec2): void {
    const beam = new BeamSpellObject<SpearTarget>(this.owner, {
      start,
      end: { x: start.x + direction.x * 560, y: start.y + direction.y * 560 },
      width: 120,
    }, { onHit: target => this.damage(target, 20) });
    this.game.objectManager.addObject(beam);
  }

  private directionTo(context: CastContext, origin: Vec2): Vec2 {
    const dx = context.cursorWorld.x - origin.x;
    const dy = context.cursorWorld.y - origin.y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? context.direction : { x: dx / length, y: dy / length };
  }

  private damage(target: SpearTarget, baseDamage: number): void {
    const execute = target.stats.health.value < target.stats.maxHealth.value * 0.2;
    target.takeDamage(execute ? baseDamage * 2 : baseDamage, this.owner);
  }

  private removeChargeSlow(): void {
    this.chargeSlow?.deactivateBuff();
    this.chargeSlow = undefined;
  }
}

export class Pantheon_Q_Spear extends MissileSpellObject {
  image = AssetManager.getAsset('spell_pantheon_q');
  speed = 16;
  size = 110;
  maxHitCount = Infinity;

  onHit(enemy: SpearTarget): void {
    const baseDamage = this.hitTargets.length === 1 ? 20 : 10;
    const execute = enemy.stats.health.value < enemy.stats.maxHealth.value * 0.2;
    enemy.takeDamage(execute ? baseDamage * 2 : baseDamage, this.owner);
  }
}
