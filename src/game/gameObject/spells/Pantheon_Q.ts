import AssetManager from '../../../managers/AssetManager';
import type { CancelReason, CastContext, CastSpec, Vec2 } from '../../spell/runtime/types';
import BeamSpellObject from '../spellObjects/BeamSpellObject';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import TrailSystem from '../helpers/TrailSystem';
import CastBar, { unitCastBarAnchor } from '../../vfx/CastBar';
import ChargeRangeTelegraph from '../../vfx/ChargeRangeTelegraph';
import VfxGroup from '../../vfx/VfxGroup';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Monster from '../attackableUnits/Monster';

const HOLD_THRESHOLD_MS = 350;
const MAX_CHARGE_MS = 4_000;
const RANGE = 700;
const MIN_RANGE = 100;
const RANGE_CHARGE_MS = 1_500;

type SpearTarget = AttackableUnit & {
  readonly unitType?: 'minion';
};

const damageMultiplier = (target: SpearTarget): number =>
  target instanceof Monster ? 0.8 : target.unitType === 'minion' ? 0.7 : 1;

const spearDamage = (target: SpearTarget, subsequent: boolean): number => {
  const executeMultiplier = target.stats.health.value < target.stats.maxHealth.value * 0.2 ? 2 : 1;
  return 20 * damageMultiplier(target) * executeMultiplier * (subsequent ? 0.5 : 1);
};

export default class Pantheon_Q extends Spell {
  image = AssetManager.get('spell_pantheon_q');
  name = 'Ngọn Giáo Sao Băng (Pantheon_Q)';
  description = 'Thả sớm để đâm giáo, hoặc giữ để ném một ngọn giáo xuyên.';
  coolDown = 4_000;
  manaCost = 25;

  private chargeMs = 0;
  private chargeSlow?: Slow;
  private wasThrust = false;
  private castDirection: Vec2 = { x: 0, y: 0 };
  private aimContext?: CastContext;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'TAP_OR_HOLD',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: MAX_CHARGE_MS, releaseAtMax: false },
      resource: { commitAt: 'start', refundOn: ['MAX_DURATION', 'DEATH', 'SILENCE', 'STUN'] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
      interrupts: { move: false },
      vfx: {
        castLoop: context =>
          new VfxGroup([
            new CastBar(
              context,
              () => this.chargeMs / MAX_CHARGE_MS,
              undefined,
              () => unitCastBarAnchor(this.owner)
            ),
            new ChargeRangeTelegraph(
              () => this.owner.position,
              () => this.castDirection,
              () => this.currentRange,
              () => this.chargeMs / RANGE_CHARGE_MS
            ),
          ]),
      },
    };
  }

  onCastStart(context: CastContext): void {
    this.chargeMs = 0;
    this.wasThrust = false;
    this.castDirection = context.direction;
    this.aimContext = context;
    this.chargeSlow = new Slow(MAX_CHARGE_MS, this.owner, this.owner);
    this.chargeSlow.percent = 0.1;
    this.chargeSlow.stackId = 'pantheon_q_charge_slow';
    this.owner.addBuff(this.chargeSlow);
  }

  onChargeUpdate(_context: CastContext, elapsedMs: number): void {
    this.chargeMs = elapsedMs;
  }

  hold(context: CastContext): boolean {
    this.aimContext = context;
    this.castDirection = this.directionTo(context);
    return super.hold(context);
  }

  release(context: CastContext): boolean {
    this.aimContext = context;
    this.castDirection = this.directionTo(context);
    return super.release(context);
  }

  onUpdate(): void {
    if (this.state !== 'CHARGING') return;
    if (this.owner.isDead) this.cancel('DEATH');
    else if (!this.owner.canCast) this.cancel('SILENCE');
  }

  onRelease(context: CastContext): void {
    this.removeChargeSlow();
    const start = { x: this.owner.position.x, y: this.owner.position.y };
    const direction = this.directionTo(this.aimContext ?? context);
    if (this.chargeMs <= HOLD_THRESHOLD_MS) {
      this.createThrust(start, direction);
      this.wasThrust = true;
      return;
    }

    const spear = new Pantheon_Q_Spear(this.owner);
    spear.destination = createVector(
      start.x + direction.x * this.currentRange,
      start.y + direction.y * this.currentRange
    );
    this.game.objectManager.addObject(spear);
  }

  onCancel(_context: CastContext, reason: CancelReason): void {
    this.removeChargeSlow();
    if (
      reason === 'MAX_DURATION' ||
      reason === 'DEATH' ||
      reason === 'SILENCE' ||
      reason === 'STUN'
    ) {
      this.changeResource(this.owner.stats.mana, -this.manaCost / 2);
    }
  }

  onComplete(_context: CastContext): void {
    if (this.wasThrust) this.currentCooldown = this.coolDown * 0.4;
  }

  private createThrust(start: Vec2, direction: Vec2): void {
    const beam = new BeamSpellObject(
      this.owner,
      {
        start: { x: start.x - direction.x * 40, y: start.y - direction.y * 40 },
        end: { x: start.x + direction.x * 560, y: start.y + direction.y * 560 },
        width: 120,
      },
      {
        candidateFilter: target =>
          target instanceof AttackableUnit &&
          target.targetable &&
          !target.isDead &&
          target.teamId !== this.owner.teamId,
        onHit: target => target.takeDamage(spearDamage(target, false), this.owner),
      }
    );
    this.game.objectManager.addObject(beam);
  }

  private removeChargeSlow(): void {
    this.chargeSlow?.deactivateBuff();
    this.chargeSlow = undefined;
  }

  get currentRange(): number {
    return MIN_RANGE + (RANGE - MIN_RANGE) * Math.min(1, this.chargeMs / RANGE_CHARGE_MS);
  }

  private directionTo(context: CastContext): Vec2 {
    const dx = context.cursorWorld.x - this.owner.position.x;
    const dy = context.cursorWorld.y - this.owner.position.y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? context.direction : { x: dx / length, y: dy / length };
  }
}

export class Pantheon_Q_Spear extends MissileSpellObject {
  speed = 1_400 / 60;
  size = 32;
  visualWidth = 84;
  visualHeight = 30;
  maxHitCount = Infinity;

  trailSystem = new TrailSystem({
    trailColor: '#FD8A',
    trailSize: this.visualHeight * 0.4,
    trailLifeTime: 300,
  });

  draw(): void {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    const half = this.visualWidth / 2;
    const blade = this.visualHeight * 0.4;

    push();
    translate(this.position.x, this.position.y);
    rotate(angle);

    // Starlight burning along the haft only. Extended past the tip with round
    // caps it painted a gold blob in front of the blade, blunting the spear.
    blendMode(ADD);
    strokeCap(SQUARE);
    noFill();
    stroke(255, 190, 90, 60);
    strokeWeight(7);
    line(-half * 0.95, 0, half * 0.3, 0);
    stroke(255, 236, 190, 95);
    strokeWeight(2.5);
    line(-half * 0.95, 0, half * 0.3, 0);
    blendMode(BLEND);
    strokeCap(ROUND);

    // haft: dark wood with a bronze highlight along the top
    stroke(84, 52, 26, 245);
    strokeWeight(4.5);
    line(-half * 0.95, 0, half * 0.34, 0);
    stroke(206, 160, 92, 220);
    strokeWeight(1.3);
    line(-half * 0.95, -1.3, half * 0.34, -1.3);

    noStroke();
    fill(176, 132, 68, 235);
    ellipse(-half * 0.95, 0, 6, blade * 0.7);

    // socket collar, kept slim so it does not read as a bead on the shaft
    fill(198, 150, 78, 240);
    quad(half * 0.28, -2.6, half * 0.4, -2.2, half * 0.4, 2.2, half * 0.28, 2.6);

    // narrow leaf blade, drawn over the collar so the point stays the far end
    fill(255, 248, 224, 250);
    beginShape();
    vertex(half, 0);
    bezierVertex(half * 0.72, -blade * 0.85, half * 0.52, -blade * 0.55, half * 0.38, 0);
    bezierVertex(half * 0.52, blade * 0.55, half * 0.72, blade * 0.85, half, 0);
    endShape(CLOSE);

    // mid-rib keeps the blade from reading as a flat blob at speed
    stroke(198, 146, 58, 190);
    strokeWeight(1);
    line(half * 0.44, 0, half * 0.93, 0);

    pop();
  }

  onHit(enemy: AttackableUnit): void {
    enemy.takeDamage(spearDamage(enemy, this.hitTargets.length > 1), this.owner);
  }
}
