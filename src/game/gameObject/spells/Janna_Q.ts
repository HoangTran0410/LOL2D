import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Airborne from '../buffs/Airborne';
import TrailSystem from '../helpers/TrailSystem';

/**
 * Howling Gale is a charged spell, not a plain skillshot: the whirlwind is summoned
 * where Janna stands and grows in place for up to 3 seconds, gaining range, speed,
 * damage and knock-up duration. Recasting fires it early; holding it to full charge
 * releases it automatically.
 */
export default class Janna_Q extends Spell {
  static PHASES = {
    CHARGE: { image: AssetManager.getAsset('spell_janna_q') },
    RELEASE: { image: AssetManager.getAsset('spell_janna_q2') },
  };
  phase: 'CHARGE' | 'RELEASE' = 'CHARGE';

  image = Janna_Q.PHASES[this.phase].image;
  name = 'Bão Tố (Janna_Q)';
  description =
    'Triệu hồi một cơn lốc tại chỗ và <span class="buff">tích luỹ sức mạnh</span> trong tối đa <span class="time">3 giây</span>. Tái kích hoạt để phóng cơn lốc về hướng con trỏ, hoặc nó tự phóng khi tích đầy. Tích càng lâu thì tầm bay, tốc độ, sát thương và thời gian hất tung càng lớn: gây <span class="damage">15 - 30 sát thương</span> và <span class="buff">Hất Tung</span> trong <span class="time">0.5 - 1.25 giây</span>, xuyên qua mọi kẻ địch trên đường đi';
  coolDown = 10000;
  manaCost = 40;

  minRange = 400;
  maxRange = 640;
  maxChargeTime = 3000;

  spellObject: Janna_Q_Object | null = null;

  onSpellCast() {
    if (this.phase === 'CHARGE') this.startCharging();
    else this.releaseStorm();
  }

  startCharging() {
    const obj = new Janna_Q_Object(this.owner);
    obj.maxChargeTime = this.maxChargeTime;
    obj.onReleased = () => this.endCharge();
    obj.getReleaseDestination = (chargeRatio: number) => this.getDestination(obj, chargeRatio);
    this.spellObject = obj;
    this.game.objectManager.addObject(obj);

    this.phase = 'RELEASE';
    this.image = Janna_Q.PHASES.RELEASE.image;
    // the recast has to be available immediately while the storm builds up
    this.currentCooldown = 150;
  }

  releaseStorm() {
    // fires the storm early; the object calls back into endCharge()
    this.spellObject?.release();
    this.endCharge();
  }

  /** The storm flies from where it was summoned, not from Janna. */
  getDestination(obj: Janna_Q_Object, chargeRatio: number) {
    const range = lerp(this.minRange, this.maxRange, chargeRatio);
    const aim = this.game.worldMouse ?? this.owner.position;
    const { to } = VectorUtils.getVectorWithRange(obj.position, aim, range);
    return to;
  }

  endCharge() {
    if (this.phase !== 'RELEASE') return;
    this.phase = 'CHARGE';
    this.image = Janna_Q.PHASES.CHARGE.image;
    this.spellObject = null;
    this.currentCooldown = this.coolDown;
  }

  onUpdate() {
    // the storm dies with its caster; don't leave the spell stuck mid-charge
    if (this.phase === 'RELEASE' && this.spellObject?.toRemove) this.endCharge();
  }

  drawPreview() {
    super.drawPreview(this.phase === 'CHARGE' ? this.maxRange : this.currentRange);
  }

  get currentRange(): number {
    const ratio = this.spellObject ? this.spellObject.chargeRatio : 0;
    return lerp(this.minRange, this.maxRange, ratio);
  }
}

export class Janna_Q_Object extends MissileSpellObject {
  maxChargeTime = 3000;
  chargeTime = 0;
  charging = true;

  minSize = 30;
  maxSize = 95;
  size = this.minSize;

  minSpeed = 6;
  maxSpeed = 10;
  speed = this.minSpeed;

  minDamage = 15;
  maxDamage = 30;
  minAirborneTime = 500;
  maxAirborneTime = 1250;

  angle = 0;
  // the storm blows through everyone it touches
  maxHitCount = Infinity;

  onReleased: (() => void) | null = null;
  getReleaseDestination: ((chargeRatio: number) => p5.Vector) | null = null;

  trailSystem = new TrailSystem({
    trailSize: this.maxSize / 2,
    trailColor: '#B9F3E433',
  });

  get chargeRatio(): number {
    return constrain(this.chargeTime / this.maxChargeTime, 0, 1);
  }

  update() {
    if (this.charging) {
      if (this.owner.isDead) {
        this.toRemove = true;
        return;
      }

      this.chargeTime += deltaTime;
      // it visibly winds itself up while it charges, then keeps that size in flight
      this.size = lerp(this.minSize, this.maxSize, this.chargeRatio);
      this.angle += 0.15 + 0.35 * this.chargeRatio;

      if (this.chargeTime >= this.maxChargeTime) this.release();
      return;
    }

    super.update();
    this.angle += 0.25;
  }

  /** Launches the storm with whatever charge it has accumulated. */
  release() {
    if (!this.charging) return;

    const ratio = this.chargeRatio;
    this.charging = false;
    this.speed = lerp(this.minSpeed, this.maxSpeed, ratio);
    const fallbackAim = this.game.worldMouse ?? this.owner.position;
    this.destination =
      this.getReleaseDestination?.(ratio) ??
      VectorUtils.getVectorWithRange(this.position, fallbackAim, 400).to;

    this.onReleased?.();
    this.onReleased = null;
  }

  getCurrentDamage(): number {
    return Math.round(lerp(this.minDamage, this.maxDamage, this.chargeRatio));
  }

  getCurrentAirborneTime(): number {
    return Math.round(lerp(this.minAirborneTime, this.maxAirborneTime, this.chargeRatio));
  }

  onHit(enemy: any) {
    enemy.takeDamage(this.getCurrentDamage(), this.owner);

    const airborneBuff = new Airborne(this.getCurrentAirborneTime(), this.owner, enemy);
    airborneBuff.image = AssetManager.getAsset('spell_janna_q');
    airborneBuff.height = 25;
    enemy.addBuff(airborneBuff);
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    noFill();
    strokeWeight(3);
    for (let i = 0; i < 3; i++) {
      const radius = this.size * (1 - i * 0.28);
      stroke(185, 243, 228, 220 - i * 55);
      arc(0, 0, radius, radius, i * 0.7, i * 0.7 + PI * 1.4);
    }

    noStroke();
    fill(230, 255, 250, 90);
    circle(0, 0, this.size * 0.35);
    pop();

    // charge meter, so the player can see how much power is stored
    if (this.charging) {
      push();
      translate(this.position.x, this.position.y);
      noFill();
      stroke(255, 255, 255, 200);
      strokeWeight(3);
      arc(
        0,
        0,
        this.maxSize + 16,
        this.maxSize + 16,
        -HALF_PI,
        -HALF_PI + TWO_PI * this.chargeRatio
      );
      pop();
    }
  }
}
