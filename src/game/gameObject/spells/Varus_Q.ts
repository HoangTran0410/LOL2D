import AssetManager from '../../../managers/AssetManager';
import type { CancelReason, CastContext, CastSpec } from '../../spell/runtime/types';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import CastBar from '../../vfx/CastBar';
import ChargeRangeTelegraph from '../../vfx/ChargeRangeTelegraph';
import VfxGroup from '../../vfx/VfxGroup';

const MAX_CHARGE_MS = 4_000;
const RANGE_CHARGE_MS = 1_500;
const DAMAGE_CHARGE_MS = 1_250;
const MIN_CENTER_TRAVEL = 825;
const MAX_CENTER_TRAVEL = 1_525;

export default class Varus_Q extends Spell {
  image = AssetManager.get('spell_varus_q');
  name = 'Mũi Tên Xuyên Phá (Varus_Q)';
  description = 'Giữ để tích lực rồi bắn một mũi tên xuyên theo hướng con trỏ.';
  coolDown = 5_000;
  manaCost = 50;

  private chargeMs = 0;
  private aimContext?: CastContext;
  private chargeSlow?: Slow;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'HOLD_RELEASE',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: MAX_CHARGE_MS, releaseAtMax: false },
      resource: { commitAt: 'start', refundOn: ['MAX_DURATION', 'DEATH', 'SILENCE', 'STUN'] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      interrupts: { move: false },
      vfx: {
        castLoop: context => new VfxGroup([
          new CastBar(context, () => this.chargeMs / MAX_CHARGE_MS, undefined, () => this.owner.position),
          new ChargeRangeTelegraph(
            () => this.owner.position,
            () => this.aimDirection,
            () => this.currentRange,
            () => this.chargeMs / RANGE_CHARGE_MS
          ),
        ]),
      },
    };
  }

  hold(context: CastContext): boolean {
    this.aimContext = context;
    return super.hold(context);
  }

  onCastStart(context: CastContext): void {
    this.chargeMs = 0;
    this.aimContext = context;
    this.chargeSlow = new Slow(MAX_CHARGE_MS, this.owner, this.owner);
    this.chargeSlow.percent = 0.2;
    this.chargeSlow.stackId = 'varus_q_charge_slow';
    this.owner.addBuff(this.chargeSlow);
  }

  onChargeUpdate(_context: CastContext, elapsedMs: number): void {
    this.chargeMs = elapsedMs;
  }

  onUpdate(): void {
    if (this.state !== 'CHARGING') return;
    if (this.owner.isDead) this.cancel('DEATH');
    else if (!this.owner.canCast) this.cancel('SILENCE');
  }

  onRelease(context: CastContext): void {
    this.removeChargeSlow();
    const aim = this.aimContext ?? context;
    const range = this.rangeAt(this.chargeMs);
    const origin = this.owner.position;
    const direction = this.directionTo(aim, origin.x, origin.y);
    const arrow = new Varus_Q_Arrow(this.owner);
    arrow.destination = createVector(origin.x + direction.x * range, origin.y + direction.y * range);
    arrow.damage = this.damageAt(this.chargeMs);
    this.game.objectManager.addObject(arrow);
  }

  onCancel(_context: CastContext, reason: CancelReason): void {
    this.removeChargeSlow();
    if (reason === 'MAX_DURATION' || reason === 'DEATH' || reason === 'SILENCE' || reason === 'STUN') {
      this.changeResource(this.owner.stats.mana, -this.manaCost / 2);
    }
  }

  private rangeAt(elapsedMs: number): number {
    return MIN_CENTER_TRAVEL +
      (MAX_CENTER_TRAVEL - MIN_CENTER_TRAVEL) * Math.min(1, elapsedMs / RANGE_CHARGE_MS);
  }

  get currentRange(): number { return this.rangeAt(this.chargeMs); }

  private get aimDirection(): { x: number; y: number } {
    const aim = this.aimContext;
    return aim ? this.directionTo(aim, this.owner.position.x, this.owner.position.y) : { x: 0, y: 0 };
  }

  private damageAt(elapsedMs: number): number {
    return 20 + 10 * Math.min(1, elapsedMs / DAMAGE_CHARGE_MS);
  }

  private directionTo(context: CastContext, x: number, y: number): { x: number; y: number } {
    const dx = context.cursorWorld.x - x;
    const dy = context.cursorWorld.y - y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? context.direction : { x: dx / length, y: dy / length };
  }

  private removeChargeSlow(): void {
    this.chargeSlow?.deactivateBuff();
    this.chargeSlow = undefined;
  }
}

export class Varus_Q_Arrow extends MissileSpellObject {
  image = AssetManager.get('spell_varus_q');
  speed = 1_900 / 60;
  size = 36;
  visualWidth = 90;
  visualHeight = 32;
  maxHitCount = Infinity;
  damage = 20;

  onHit(enemy: { takeDamage(damage: number, owner: unknown): void }): void {
    const reduction = Math.min(0.67, this.hitTargets.length > 1 ? (this.hitTargets.length - 1) * 0.15 : 0);
    enemy.takeDamage(this.damage * (1 - reduction), this.owner);
  }
}
