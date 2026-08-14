import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Slow from '../buffs/Slow';
import TrailSystem from '../helpers/TrailSystem';

export default class Ashe_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_ashe_q');
  name = 'Mưa Tên Băng Giá (Ashe_Q)';
  description =
    'Bắn liên tiếp <span>3 mũi tên băng</span> theo hình nón hẹp. Mỗi mũi tên gây <span class="damage">8 sát thương</span> và <span class="buff">Làm Chậm 30%</span> kẻ địch trúng chiêu trong <span class="time">1 giây</span>';
  coolDown = 4000;
  manaCost = 15;

  range = 500;
  arrowCount = 3;
  /** Gap between neighbouring arrows — small, so the volley stays on one target. */
  angleStep = Math.PI / 30;

  onSpellCast() {
    const angle = VectorUtils.getAngle(this.owner.position, this.aimPoint);

    for (let i = 0; i < this.arrowCount; i++) {
      const arrowAngle = angle + (i - (this.arrowCount - 1) / 2) * this.angleStep;
      const { from, to } = VectorUtils.getVectorWithAngleAndRange(
        this.owner.position,
        arrowAngle,
        this.range
      );

      const obj = new Ashe_Q_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.direction = p5.Vector.fromAngle(arrowAngle);
      this.game.objectManager.addObject(obj);
    }

    // muzzle flash: a frosted fan showing the volley leaving the bow
    const flash = new Ashe_Q_Muzzle(this.owner);
    flash.angle = angle;
    flash.spread = this.angleStep * (this.arrowCount - 1);
    this.game.objectManager.addObject(flash);
  }
}

export class Ashe_Q_Object extends MissileSpellObject {
  speed = 13;
  size = 9;
  damage = 8;
  maxHitCount = 1;

  slowPercent = 0.3;
  slowDuration = 1000;

  /** Cosmetic only: how far the arrow has flown, drives the vapour wobble. */
  _flightTime = random(0, 600);

  trailSystem = new TrailSystem({
    maxLength: 12,
    trailSize: 5,
    trailColor: '#8FE0FF77',
  });

  onAfterMove() {
    this._flightTime += deltaTime;
  }

  onArrive() {
    // cut the trail at the end of the flight instead of letting it linger
    if (this.trailSystem) this.trailSystem.toRemove = true;
  }

  onHit(enemy: any) {
    const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
    slowBuff.percent = this.slowPercent;
    slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
    enemy.addBuff(slowBuff);

    enemy.takeDamage(this.damage, this.owner);

    // the arrow is removed this frame, so the shatter has to be its own object
    const shatter = new Ashe_Q_Shatter(this.owner);
    shatter.position = enemy.position.copy();
    shatter.angle = this.direction.heading();
    shatter.targetSize = enemy.animatedValues?.displaySize ?? 40;
    this.game.objectManager.addObject(shatter);
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    // cold glow around the shaft, additive so overlapping arrows read as a volley
    blendMode(ADD);
    noStroke();
    fill(60, 150, 220, 60);
    ellipse(-4, 0, 46, 14);
    blendMode(BLEND);

    // frozen vapour peeling off the shaft
    noStroke();
    for (let i = 0; i < 3; i++) {
      const phase = this._flightTime / 60 + i * 2;
      fill(200, 240, 255, 70 - i * 18);
      circle(-16 - i * 7, sin(phase) * (2 + i), 7 - i * 1.5);
    }

    // shaft, dark-edged so it never washes out against the light terrain
    stroke(30, 60, 90, 200);
    strokeWeight(5);
    line(-18, 0, 6, 0);
    stroke(150, 220, 255, 240);
    strokeWeight(2.5);
    line(-18, 0, 6, 0);

    // fletching
    noStroke();
    fill(120, 190, 235, 230);
    triangle(-18, 0, -9, -6, -6, 0);
    triangle(-18, 0, -9, 6, -6, 0);

    // arrowhead: a hard white ice barb
    stroke(40, 90, 130, 220);
    strokeWeight(1.5);
    fill(240, 253, 255, 250);
    beginShape();
    vertex(20, 0);
    vertex(4, -6);
    vertex(8, 0);
    vertex(4, 6);
    endShape(CLOSE);

    pop();
  }

  // the sprite is much longer than the 9px hitbox, so widen the display box only
  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - 30,
      y: this.position.y - 30,
      w: 60,
      h: 60,
      data: this,
    });
  }
}

/** Fan of frost left at the bow when the volley launches. */
export class Ashe_Q_Muzzle extends SpellObject {
  angle = 0;
  spread = 0.2;
  age = 0;
  lifeTime = 220;
  reach = 70;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const alpha = 180 * (1 - t);
    const r = this.reach * (0.3 + t);

    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(this.angle);
    noFill();
    stroke(190, 235, 255, alpha);
    strokeWeight(3 * (1 - t) + 1);
    arc(0, 0, r * 2, r * 2, -this.spread - 0.35, this.spread + 0.35);
    stroke(120, 200, 245, alpha * 0.7);
    strokeWeight(2);
    arc(0, 0, r * 1.4, r * 1.4, -this.spread - 0.2, this.spread + 0.2);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.owner.position.x - this.reach,
      y: this.owner.position.y - this.reach,
      w: this.reach * 2,
      h: this.reach * 2,
      data: this,
    });
  }
}

/** Ice shattering on the victim — the moment of the hit. */
export class Ashe_Q_Shatter extends SpellObject {
  angle = 0;
  targetSize = 40;
  age = 0;
  lifeTime = 320;
  maxRadius = 46;

  _shards: { a: number; len: number; speed: number }[] = [];

  onAdded() {
    for (let i = 0; i < 6; i++) {
      this._shards.push({
        a: this.angle + random(-1.1, 1.1),
        len: random(9, 17),
        speed: random(0.7, 1.5),
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

    // white flash right on impact
    if (t < 0.35) {
      blendMode(ADD);
      noStroke();
      fill(200, 240, 255, 150 * (1 - t / 0.35));
      circle(0, 0, this.targetSize * 0.9 + t * 40);
      blendMode(BLEND);
    }

    // frost ring showing exactly who got clipped
    noFill();
    stroke(160, 225, 255, 220 * fade);
    strokeWeight(3 * fade + 1);
    circle(0, 0, this.targetSize * 0.7 + this.maxRadius * t);

    // shards thrown forward along the arrow's line
    stroke(225, 248, 255, 230 * fade);
    strokeWeight(2.5 * fade + 0.5);
    for (const s of this._shards) {
      const d = 8 + this.maxRadius * t * s.speed;
      const dx = cos(s.a);
      const dy = sin(s.a);
      line(dx * d, dy * d, dx * (d + s.len * fade), dy * (d + s.len * fade));
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.maxRadius + this.targetSize;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
