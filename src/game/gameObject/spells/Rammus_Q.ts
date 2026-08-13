import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Airborne from '../buffs/Airborne';
import Slow from '../buffs/Slow';
import Speedup from '../buffs/Speedup';
import TrailSystem from '../helpers/TrailSystem';

/**
 * Powerball. The real spell accelerates: Rammus gains bonus movement speed every
 * second he keeps rolling, up to a large cap, and stops the moment he hits
 * something — knocking the enemies he crashes into up, then slowing them.
 */
export default class Rammus_Q extends Spell {
  image = AssetManager.get('spell_rammus_q');
  name = 'Nhím Lăn (Rammus_Q)';
  description =
    'Cuộn tròn lăn đi trong <span class="time">4 giây</span>, <span class="buff">Tăng Tốc</span> tăng dần từ <span class="buff">20%</span> lên tới <span class="buff">120%</span> theo thời gian lăn. Kẻ địch va phải nhận <span class="damage">30 sát thương</span>, bị <span class="buff">Hất Tung</span> trong <span class="time">0.5 giây</span> rồi <span class="buff">Làm Chậm 60%</span> trong <span class="time">1.5 giây</span>, đồng thời kết thúc cú lăn.';
  coolDown = 8000;
  manaCost = 20;

  duration = 4000;
  startPercent = 0.2;
  maxPercent = 1.2;
  damage = 30;
  airborneTime = 500;
  slowPercent = 0.6;
  slowTime = 1500;

  onSpellCast() {
    const speedupBuff = new Rammus_Q_Powerball(this.duration, this.owner, this.owner);
    speedupBuff.startPercent = this.startPercent;
    speedupBuff.maxPercent = this.maxPercent;
    speedupBuff.rampDuration = this.duration;
    speedupBuff.percent = this.startPercent;
    speedupBuff.image = this.image;
    this.owner.addBuff(speedupBuff);

    const obj = new Rammus_Q_Object(this.owner);
    obj.lifeTime = this.duration;
    obj.damage = this.damage;
    obj.airborneTime = this.airborneTime;
    obj.slowPercent = this.slowPercent;
    obj.slowTime = this.slowTime;
    obj.speedupBuff = speedupBuff;
    this.game.objectManager.addObject(obj);
  }
}

/**
 * The accelerating half of Powerball. `Stats` applies a modifier by adding its
 * numbers in, not by holding a reference, so ramping means re-seating the
 * modifier each time the bonus changes.
 */
export class Rammus_Q_Powerball extends Speedup {
  name = 'Nhím Lăn';

  startPercent = 0.2;
  maxPercent = 1.2;
  rampDuration = 4000;
  percent = 0.2;

  onUpdate(): void {
    super.onUpdate();

    const progress = constrain(this.timeElapsed / this.rampDuration, 0, 1);
    const newPercent = lerp(this.startPercent, this.maxPercent, progress);
    if (Math.abs(newPercent - this.percent) < 0.0001) return;

    this.targetUnit.stats.removeModifier(this.statsModifier);
    this.statsModifier.speed.percentBaseBonus = newPercent;
    this.targetUnit.stats.addModifier(this.statsModifier);
    this.percent = newPercent;
  }

  /** 0 at the start of the roll, 1 once it is at full tilt — drives the visuals. */
  get rampProgress(): number {
    return constrain(this.timeElapsed / this.rampDuration, 0, 1);
  }
}

/**
 * The ball is not a projectile: it is glued to the caster and rolls wherever
 * they run, so it reads `owner.position` every frame instead of travelling.
 */
export class Rammus_Q_Object extends SpellObject {
  position = this.owner.position.copy();
  size = 46;
  lifeTime = 4000;
  age = 0;
  angle = 0;
  rollSpeed = 0.15;
  damage = 30;
  airborneTime = 500;
  slowPercent = 0.6;
  slowTime = 1500;
  speedupBuff: Rammus_Q_Powerball | null = null;

  /** Cosmetic: dust thrown up by the roll, denser the faster he goes. */
  _dust: { x: number; y: number; age: number; size: number; vx: number; vy: number }[] = [];
  _dustTimer = 0;

  trailSystem = new TrailSystem({
    trailSize: this.size / 2,
    trailColor: '#d2a04c55',
    maxLength: 20,
  });

  onAdded() {
    this.game.objectManager.addObject(this.trailSystem);
  }

  update() {
    this.age += deltaTime;

    this.position.set(this.owner.position.x, this.owner.position.y);
    // spins faster the further the roll has ramped up
    const ramp = this.speedupBuff?.rampProgress ?? 0;
    this.angle += this.rollSpeed * (1 + ramp * 3);
    this.trailSystem.addTrail(this.position);
    this._updateDust(ramp);

    if (this.age >= this.lifeTime || this.owner.isDead) {
      this.toRemove = true;
      return;
    }

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.size / 2,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    if (enemies.length === 0) return;

    // impact: everyone Rammus crashes into is hit, knocked up, then slowed
    for (const victim of enemies) {
      victim.takeDamage(this.damage, this.owner);

      const airborneBuff = new Airborne(this.airborneTime, this.owner, victim);
      victim.addBuff(airborneBuff);

      const slowBuff = new Slow(this.slowTime, this.owner, victim);
      slowBuff.percent = this.slowPercent;
      victim.addBuff(slowBuff);
    }

    // the crash needs its own object: this one is gone before the next draw pass
    const crash = new Rammus_Q_Crash(this.owner);
    crash.position = this.position.copy();
    crash.power = this.speedupBuff?.rampProgress ?? 0;
    this.game.objectManager.addObject(crash);

    // connecting ends the roll early, speed boost included
    this.speedupBuff?.deactivateBuff();
    this.toRemove = true;
  }

  _updateDust(ramp: number) {
    // faster roll, more grit: the ramp has to be visible on the ground too
    const interval = 90 - 60 * ramp;
    this._dustTimer += deltaTime;
    if (this._dustTimer >= interval && this._dust.length < 26) {
      this._dustTimer = 0;
      const back = random(TWO_PI);
      this._dust.push({
        x: this.position.x + cos(back) * this.size * 0.4,
        y: this.position.y + sin(back) * this.size * 0.4,
        age: 0,
        size: random(9, 18) * (0.7 + ramp),
        vx: random(-0.7, 0.7),
        vy: random(-0.7, 0.7),
      });
    }

    let i = 0;
    while (i < this._dust.length) {
      const d = this._dust[i];
      d.age += deltaTime;
      d.x += d.vx;
      d.y += d.vy;
      if (d.age >= 500) this._dust.splice(i, 1);
      else i++;
    }
  }

  draw() {
    const r = this.size / 2;
    const ramp = this.speedupBuff?.rampProgress ?? 0;

    // dust kicked off the ground, drawn under the ball
    push();
    noStroke();
    for (const d of this._dust) {
      const t = d.age / 500;
      fill(196, 165, 120, 130 * (1 - t));
      circle(d.x, d.y, d.size * (1 + t * 0.8));
    }
    pop();

    push();
    translate(this.position.x, this.position.y);

    // heat haze that grows with the ramp, so top speed is unmistakable
    if (ramp > 0.05) {
      blendMode(ADD);
      noStroke();
      fill(255, 170, 60, 30 + 60 * ramp);
      circle(0, 0, this.size * (1.4 + 0.7 * ramp));
      blendMode(BLEND);
    }

    rotate(this.angle);

    stroke(90, 60, 30);
    strokeWeight(3);
    fill(205, 155, 75);
    circle(0, 0, this.size);

    // shell spikes, pointing outwards
    noStroke();
    fill(240, 228, 200);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI;
      triangle(
        cos(a) * (r + 6),
        sin(a) * (r + 6),
        cos(a + 0.3) * (r - 3),
        sin(a + 0.3) * (r - 3),
        cos(a - 0.3) * (r - 3),
        sin(a - 0.3) * (r - 3)
      );
    }

    // a couple of plates so the spin is readable
    stroke(120, 80, 40, 200);
    strokeWeight(2);
    noFill();
    arc(0, 0, this.size * 0.6, this.size * 0.6, 0, PI);
    arc(0, 0, this.size * 0.85, this.size * 0.85, PI + 0.4, TWO_PI - 0.4);
    pop();

    push();
    translate(this.position.x, this.position.y);

    // speed streaks, more and longer the faster he is going
    if (ramp > 0.1) {
      const lines = 2 + Math.round(ramp * 5);
      stroke(255, 235, 190, 60 + 120 * ramp);
      strokeWeight(2);
      for (let i = 0; i < lines; i++) {
        const a = this.angle * 0.15 + (i * TWO_PI) / lines;
        const r0 = r + 10;
        const len = 10 + 28 * ramp;
        line(cos(a) * r0, sin(a) * r0, cos(a) * (r0 + len), sin(a) * (r0 + len));
      }
    }

    // a ring that closes as the roll reaches top speed
    if (ramp > 0) {
      noFill();
      stroke(255, 220, 150, 60);
      strokeWeight(3);
      circle(0, 0, this.size + 14);
      // hotter and thicker the closer he is to full tilt
      stroke(255, 210 - 60 * ramp, 120 - 60 * ramp, 140 + 115 * ramp);
      strokeWeight(3 + 3 * ramp);
      arc(0, 0, this.size + 14, this.size + 14, -HALF_PI, -HALF_PI + TWO_PI * ramp);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size / 2 + 60;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** The pile-up when Powerball connects. */
export class Rammus_Q_Crash extends SpellObject {
  /** How far the roll had ramped up — a faster crash throws more debris. */
  power = 0;
  age = 0;
  lifeTime = 480;

  _debris: { a: number; speed: number; size: number; spin: number }[] = [];

  onAdded() {
    const count = 7 + Math.round(this.power * 6);
    for (let i = 0; i < count; i++) {
      this._debris.push({
        a: random(TWO_PI),
        speed: random(0.6, 1.6) * (0.7 + this.power),
        size: random(5, 12),
        spin: random(-0.4, 0.4),
      });
    }
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const reach = 60 + 90 * this.power;

    push();
    translate(this.position.x, this.position.y);

    blendMode(ADD);
    noStroke();
    fill(255, 200, 120, 120 * fade * fade);
    circle(0, 0, 70 + reach * t);
    blendMode(BLEND);

    // two shockwave rings, the outer one racing ahead
    noFill();
    stroke(255, 235, 190, 230 * fade);
    strokeWeight(5 * fade + 1);
    circle(0, 0, 30 + reach * 2 * t);
    stroke(210, 165, 90, 180 * fade);
    strokeWeight(3 * fade + 1);
    circle(0, 0, 20 + reach * 1.3 * t);

    // dirt and shell chips
    noStroke();
    for (const d of this._debris) {
      const dist = 10 + reach * t * d.speed;
      push();
      translate(cos(d.a) * dist, sin(d.a) * dist);
      rotate(d.a + t * d.spin * 12);
      fill(205, 168, 105, 235 * fade);
      const s = d.size * (1 - t * 0.4);
      triangle(0, -s, s * 0.75, s * 0.6, -s * 0.75, s * 0.6);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = 170 + this.power * 120;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
