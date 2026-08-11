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
  image = AssetManager.getAsset('spell_rammus_q');
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
      airborneBuff.image = AssetManager.getAsset('spell_rammus_q');
      victim.addBuff(airborneBuff);

      const slowBuff = new Slow(this.slowTime, this.owner, victim);
      slowBuff.image = AssetManager.getAsset('spell_rammus_q');
      slowBuff.percent = this.slowPercent;
      victim.addBuff(slowBuff);
    }

    // connecting ends the roll early, speed boost included
    this.speedupBuff?.deactivateBuff();
    this.toRemove = true;
  }

  draw() {
    const r = this.size / 2;

    push();
    translate(this.position.x, this.position.y);
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
    pop();

    // a ring that closes as the roll reaches top speed
    const ramp = this.speedupBuff?.rampProgress ?? 0;
    if (ramp > 0) {
      push();
      translate(this.position.x, this.position.y);
      noFill();
      stroke(255, 220, 150, 90 + 120 * ramp);
      strokeWeight(2);
      arc(0, 0, this.size + 14, this.size + 14, -HALF_PI, -HALF_PI + TWO_PI * ramp);
      pop();
    }
  }

  getDisplayBoundingBox() {
    const r = this.size / 2 + 10;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
