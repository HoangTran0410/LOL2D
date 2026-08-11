import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Slow from '../buffs/Slow';
import Speedup from '../buffs/Speedup';
import TrailSystem from '../helpers/TrailSystem';

export default class Malphite_Q extends Spell {
  image = AssetManager.getAsset('spell_malphite_q');
  name = 'Mảnh Vỡ Kết Tinh (Malphite_Q)';
  description =
    'Ném một mảnh đá xuyên qua mọi kẻ địch trên đường đi, gây <span class="damage">20 sát thương</span> và <span class="buff">Làm Chậm 35%</span> trong <span class="time">2 giây</span>. Nếu trúng ít nhất một kẻ địch, Malphite được <span class="buff">Tăng Tốc 20%</span> trong <span class="time">2 giây</span>';
  coolDown = 6000;
  manaCost = 25;

  range = 500;
  damage = 20;
  slowPercent = 0.35;
  slowDuration = 2000;
  speedupPercent = 0.2;
  speedupDuration = 2000;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Malphite_Q_Object(this.owner);
    obj.destination = to;
    obj.damage = this.damage;
    obj.slowPercent = this.slowPercent;
    obj.slowDuration = this.slowDuration;
    obj.speedupPercent = this.speedupPercent;
    obj.speedupDuration = this.speedupDuration;

    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Malphite_Q_Object extends MissileSpellObject {
  image = AssetManager.getAsset('spell_malphite_q');
  speed = 9;
  size = 24;
  // a shard of the mountain: it does not stop for anybody
  maxHitCount = Infinity;

  damage = 20;
  slowPercent = 0.35;
  slowDuration = 2000;
  speedupPercent = 0.2;
  speedupDuration = 2000;

  trailSystem = new TrailSystem({
    trailColor: '#D7CDF566',
    trailSize: this.size * 0.55,
  });

  _spin = random(TWO_PI);
  _grantedSpeedup = false;
  /** Cosmetic: chips of rock shaken loose behind the shard. */
  _chips: { x: number; y: number; vx: number; vy: number; age: number; size: number }[] = [];
  _chipTimer = 0;

  onAfterMove() {
    this._spin += 0.15;

    this._chipTimer += deltaTime;
    if (this._chipTimer >= 45 && this._chips.length < 14) {
      this._chipTimer = 0;
      this._chips.push({
        x: this.position.x,
        y: this.position.y,
        vx: random(-0.6, 0.6),
        vy: random(-0.6, 0.6),
        age: 0,
        size: random(3, 7),
      });
    }

    let i = 0;
    while (i < this._chips.length) {
      const c = this._chips[i];
      c.age += deltaTime;
      c.x += c.vx;
      c.y += c.vy;
      if (c.age >= 380) this._chips.splice(i, 1);
      else i++;
    }
  }

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
    slowBuff.image = this.image;
    slowBuff.percent = this.slowPercent;
    enemy.addBuff(slowBuff);

    // the caster is sped up once, no matter how many enemies the shard pierces
    if (!this._grantedSpeedup) {
      this._grantedSpeedup = true;

      const speedupBuff = new Speedup(this.speedupDuration, this.owner, this.owner);
      speedupBuff.image = this.image;
      speedupBuff.percent = this.speedupPercent;
      this.owner.addBuff(speedupBuff);

      // show the caster he got the speed-up, tied to that buff's own lifetime
      const rush = new Malphite_Q_Rush(this.owner);
      rush.buff = speedupBuff;
      this.game.objectManager.addObject(rush);
    }

    const shatter = new Malphite_Q_Shatter(this.owner);
    shatter.position = enemy.position.copy();
    shatter.targetSize = enemy.animatedValues?.displaySize ?? 40;
    this.game.objectManager.addObject(shatter);
  }

  draw() {
    push();

    // grit trailing the shard
    noStroke();
    for (const c of this._chips) {
      const t = c.age / 380;
      fill(180, 172, 200, 150 * (1 - t));
      circle(c.x, c.y, c.size * (1 - t * 0.6));
    }

    translate(this.position.x, this.position.y);

    // cold halo so the shard pops off the dark ground
    blendMode(ADD);
    noStroke();
    fill(120, 110, 190, 60);
    circle(0, 0, this.size * 2.4);
    blendMode(BLEND);

    rotate(this._spin);

    const s = this.size;

    // a chipped crystal, not a triangle: outline first so it reads on any ground
    stroke(40, 34, 54, 235);
    strokeWeight(2.5);
    fill(150, 140, 182);
    beginShape();
    vertex(0, -s * 0.95);
    vertex(s * 0.42, -s * 0.15);
    vertex(s * 0.3, s * 0.62);
    vertex(-s * 0.34, s * 0.6);
    vertex(-s * 0.46, -s * 0.2);
    endShape(CLOSE);

    // lit facet
    noStroke();
    fill(230, 224, 250);
    beginShape();
    vertex(0, -s * 0.9);
    vertex(s * 0.34, -s * 0.1);
    vertex(0, s * 0.3);
    endShape(CLOSE);

    // shadowed facet
    fill(74, 66, 96);
    beginShape();
    vertex(0, -s * 0.9);
    vertex(-s * 0.4, -s * 0.15);
    vertex(0, s * 0.3);
    endShape(CLOSE);

    // glint
    fill(255, 255, 255, 190);
    triangle(s * 0.06, -s * 0.62, s * 0.2, -s * 0.2, s * 0.02, -s * 0.24);

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size * 2;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** Rock bursting off whoever the shard cut through. */
export class Malphite_Q_Shatter extends SpellObject {
  targetSize = 40;
  age = 0;
  lifeTime = 400;

  _rocks: { a: number; speed: number; size: number; spin: number }[] = [];

  onAdded() {
    for (let i = 0; i < 8; i++) {
      this._rocks.push({
        a: random(TWO_PI),
        speed: random(0.6, 1.5),
        size: random(5, 11),
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

    push();
    translate(this.position.x, this.position.y);

    // flash on contact
    if (t < 0.3) {
      blendMode(ADD);
      noStroke();
      fill(200, 190, 255, 150 * (1 - t / 0.3));
      circle(0, 0, this.targetSize * 1.2);
      blendMode(BLEND);
    }

    // dust ring showing the impact point
    noFill();
    stroke(220, 214, 245, 235 * fade);
    strokeWeight(5 * fade + 1);
    circle(0, 0, this.targetSize * 0.6 + 70 * t);

    // tumbling rock chunks
    stroke(45, 40, 58, 220 * fade);
    strokeWeight(2);
    fill(140, 130, 168, 235 * fade);
    for (const r of this._rocks) {
      const d = 8 + 55 * t * r.speed;
      push();
      translate(cos(r.a) * d, sin(r.a) * d);
      rotate(r.a + t * r.spin * 10);
      const s = r.size * (1 - t * 0.4);
      triangle(0, -s, s * 0.8, s * 0.6, -s * 0.8, s * 0.6);
      pop();
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.targetSize + 70;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/**
 * Dust kicked up under Malphite while the shard's speed-up lasts. It watches the
 * buff instead of counting its own clock, so it can never outlive it.
 */
export class Malphite_Q_Rush extends SpellObject {
  buff: any = null;
  _puffs: { x: number; y: number; age: number; size: number }[] = [];
  _timer = 0;

  update() {
    if (!this.buff || this.buff.toRemove || this.owner.isDead) {
      // let the last puffs fade out before disappearing
      if (this._puffs.length === 0) this.toRemove = true;
    } else {
      this._timer += deltaTime;
      if (this._timer >= 60 && this._puffs.length < 14) {
        this._timer = 0;
        const r = this.owner.animatedValues.displaySize / 2;
        this._puffs.push({
          x: this.owner.position.x + random(-r, r),
          y: this.owner.position.y + random(0, r * 0.7),
          age: 0,
          size: random(8, 16),
        });
      }
    }

    let i = 0;
    while (i < this._puffs.length) {
      const p = this._puffs[i];
      p.age += deltaTime;
      if (p.age >= 500) this._puffs.splice(i, 1);
      else i++;
    }

    this.position.set(this.owner.position.x, this.owner.position.y);
  }

  draw() {
    push();
    noStroke();
    for (const p of this._puffs) {
      const t = p.age / 500;
      fill(190, 182, 210, 120 * (1 - t));
      circle(p.x, p.y - t * 6, p.size * (1 + t));
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = 90;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
