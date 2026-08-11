import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Airborne from '../buffs/Airborne';
import TrailSystem from '../helpers/TrailSystem';

/** Pale sea-green, the colour of Janna's wind. */
const WIND: [number, number, number] = [185, 243, 228];
/** What the funnel turns as it reaches full charge. */
const WIND_CHARGED: [number, number, number] = [255, 240, 170];

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

  /** Cosmetic: debris caught in the funnel, orbiting at a fixed radius ratio. */
  _motes: { angle: number; ratio: number; spin: number; lift: number; size: number }[] = [];

  onAdded() {
    super.onAdded();
    for (let i = 0; i < 16; i++) {
      this._motes.push({
        angle: random(TWO_PI),
        ratio: random(0.25, 1),
        spin: random(2.5, 6) * (random() < 0.5 ? -1 : 1),
        lift: random(0.1, 1),
        size: random(3, 7),
      });
    }
  }

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

    // the gust that lifted them, so the knock-up is not a silent hop
    const gust = new Janna_Q_Gust(this.owner);
    gust.position = enemy.position.copy();
    gust.radius = this.size * 0.8 + 40;
    this.game.objectManager.addObject(gust);
  }

  /** Green while it winds up, gold once it is fully charged. */
  _funnelColor(): [number, number, number] {
    const k = this.charging ? this.chargeRatio : 1;
    return [
      lerp(WIND[0], WIND_CHARGED[0], k),
      lerp(WIND[1], WIND_CHARGED[1], k),
      lerp(WIND[2], WIND_CHARGED[2], k),
    ];
  }

  draw() {
    const [cr, cg, cb] = this._funnelColor();
    const r = this.size / 2;
    const full = this.charging && this.chargeRatio >= 0.999;

    push();
    translate(this.position.x, this.position.y);

    // the footprint on the ground: the storm's actual width
    noStroke();
    fill(cr, cg, cb, 55);
    ellipse(0, 0, this.size * 1.05, this.size * 0.42);
    noFill();
    stroke(cr, cg, cb, 200);
    strokeWeight(3);
    ellipse(0, 0, this.size * 1.05, this.size * 0.42);

    // the funnel: rings stacked upwards, widening — a tornado, not a ball.
    // Every ring gets a dark under-stroke, or the pale wind vanishes on
    // the light half of the map.
    noFill();
    for (let i = 0; i < 5; i++) {
      const k = i / 4;
      const ringR = r * (0.25 + k * 0.95);
      const lift = -k * this.size * 0.62;
      const wobble = sin(this.angle * 1.4 + i) * this.size * 0.05;
      const a0 = this.angle + i * 1.1;

      stroke(18, 55, 48, 210);
      strokeWeight(11 - i);
      arc(wobble, lift, ringR * 2, ringR * 0.72, a0, a0 + PI * 1.35);
      stroke(cr, cg, cb, 250);
      strokeWeight(7 - i);
      arc(wobble, lift, ringR * 2, ringR * 0.72, a0, a0 + PI * 1.35);
      stroke(255, 255, 255, 210);
      strokeWeight(2.5);
      arc(wobble, lift, ringR * 2, ringR * 0.72, a0 + 0.25, a0 + PI * 1.1);
    }

    // a soft core of light inside the funnel
    push();
    blendMode(ADD);
    noStroke();
    fill(cr, cg, cb, 70);
    ellipse(0, -this.size * 0.3, this.size * 0.55, this.size * 0.75);
    blendMode(BLEND);
    pop();

    // debris caught in the vortex, climbing as it turns
    noStroke();
    for (const m of this._motes) {
      const a = m.angle + this.angle * m.spin * 0.25;
      const climb = ((frameCount / 60) * m.lift) % 1;
      const ringR = r * (0.25 + climb * 0.95) * m.ratio;
      fill(255, 255, 255, 200 * (1 - climb * 0.7));
      ellipse(
        cos(a) * ringR,
        sin(a) * ringR * 0.36 - climb * this.size * 0.62,
        m.size,
        m.size * 0.6
      );
    }

    pop();

    // charge meter, so the player can see how much power is stored
    if (this.charging) {
      push();
      translate(this.position.x, this.position.y);
      noFill();
      const meter = this.maxSize + 26;
      stroke(20, 45, 40, 180);
      strokeWeight(8);
      circle(0, 0, meter);
      stroke(cr, cg, cb, 245);
      strokeWeight(6);
      arc(0, 0, meter, meter, -HALF_PI, -HALF_PI + TWO_PI * this.chargeRatio);

      // at full charge the ring flares — it is about to fire on its own
      if (full) {
        stroke(255, 255, 235, 120 + 100 * sin(frameCount / 4));
        strokeWeight(3);
        circle(0, 0, meter + 12);
      }
      pop();
    }
  }

  // the funnel climbs well above `position`, and the meter sits outside it
  getDisplayBoundingBox() {
    const r = this.maxSize;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** The burst of wind that throws a unit into the air. */
export class Janna_Q_Gust extends SpellObject {
  position = this.owner.position.copy();
  radius = 80;
  age = 0;
  lifeTime = 420;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);

    // a flat ring of air blown out from under them
    noFill();
    stroke(WIND[0], WIND[1], WIND[2], 235 * fade);
    strokeWeight(8 * fade + 1.5);
    ellipse(0, 0, this.radius * 2 * (0.25 + t * 0.95), this.radius * 0.85 * (0.25 + t * 0.95));

    // gust streaks curling upwards around them
    stroke(255, 255, 255, 210 * fade);
    strokeWeight(3);
    for (let i = 0; i < 6; i++) {
      const a = (TWO_PI * i) / 6 + t * 2.2;
      const rr = this.radius * (0.35 + t * 0.6);
      beginShape();
      vertex(cos(a) * rr * 0.5, sin(a) * rr * 0.2);
      vertex(cos(a + 0.5) * rr * 0.8, sin(a + 0.5) * rr * 0.3 - 16 * t);
      vertex(cos(a + 1.0) * rr, sin(a + 1.0) * rr * 0.35 - 34 * t);
      endShape();
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.radius + 40;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
