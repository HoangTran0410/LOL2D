import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Root from '../buffs/Root';
import TrailSystem from '../helpers/TrailSystem';

/** Bruised violet, the colour of the whole Dark Binding kit. */
const BINDING_COLOR: [number, number, number] = [186, 96, 240];

export default class Morgana_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_morgana_q');
  name = 'Khóa Bóng Tối (Morgana_Q)';
  description =
    'Phóng một xiềng xích bóng tối đi rất xa theo hướng chỉ định, gây <span class="damage">25 sát thương</span> và <span class="buff">Trói Chân</span> kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
  coolDown = 8000;
  manaCost = 30;

  range = 700;
  damage = 25;
  rootTime = 2000;

  onSpellCast() {
    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      this.range
    );

    const obj = new Morgana_Q_Object(this.owner);
    obj.destination = destination;
    obj.range = this.range;
    obj.damage = this.damage;
    obj.rootTime = this.rootTime;

    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Morgana_Q_Object extends MissileSpellObject {
  speed = 9;
  size = 22;
  range = 700;
  damage = 25;
  rootTime = 2000;
  angle = 0;
  // the chain binds the first target it reaches and stops there
  maxHitCount = 1;

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: '#7B2FBE55',
  });

  onBeforeMove() {
    this.angle += 0.15;
  }

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const rootBuff = new Root(this.rootTime, this.owner, enemy);
    rootBuff.effectColor = [150, 60, 200, 220];
    enemy.addBuff(rootBuff);

    // the shackles snapping shut, so the bind has a moment of its own
    const snap = new Morgana_Q_Snap(this.owner);
    snap.target = enemy;
    snap.position = enemy.position.copy();
    this.game.objectManager.addObject(snap);
  }

  /** Direction of flight — the links have to lie along it, not spin freely. */
  get travelAngle(): number {
    return VectorUtils.getAngle(this.position, this.destination);
  }

  draw() {
    const alpha = map(this.position.dist(this.destination), this.range, 0, 255, 120);
    const heading = this.travelAngle;
    const [cr, cg, cb] = BINDING_COLOR;

    push();
    translate(this.position.x, this.position.y);
    rotate(heading);

    // three chain links dragging behind the head: an actual chain, not a ball
    noFill();
    for (let i = 1; i <= 3; i++) {
      const x = -i * 15;
      const shrink = 1 - i * 0.12;
      // links alternate edge-on / face-on the way a real chain twists
      const flat = i % 2 === 0;

      stroke(45, 10, 70, alpha);
      strokeWeight(6);
      ellipse(x, 0, (flat ? 8 : 20) * shrink, 15 * shrink);
      stroke(cr, cg, cb, alpha);
      strokeWeight(3);
      ellipse(x, 0, (flat ? 8 : 20) * shrink, 15 * shrink);
    }

    // the barbed head, spinning on its own axis
    push();
    rotate(this.angle);

    noStroke();
    fill(40, 8, 62, alpha);
    circle(0, 0, this.size + 10);

    // four hooked barbs — the silhouette that says "this will hold you"
    stroke(35, 5, 55, alpha);
    strokeWeight(5);
    for (let i = 0; i < 4; i++) {
      const a = (i * TWO_PI) / 4;
      line(cos(a) * 4, sin(a) * 4, cos(a) * (this.size * 0.85), sin(a) * (this.size * 0.85));
    }
    stroke(cr, cg, cb, alpha);
    strokeWeight(2.5);
    for (let i = 0; i < 4; i++) {
      const a = (i * TWO_PI) / 4;
      const tipX = cos(a) * (this.size * 0.85);
      const tipY = sin(a) * (this.size * 0.85);
      line(cos(a) * 4, sin(a) * 4, tipX, tipY);
      // the barb curls back on itself
      line(tipX, tipY, tipX - sin(a) * 6 - cos(a) * 3, tipY + cos(a) * 6 - sin(a) * 3);
    }

    noStroke();
    fill(cr, cg, cb, alpha);
    circle(0, 0, this.size * 0.7);
    fill(255, 235, 255, alpha * 0.9);
    circle(0, 0, this.size * 0.3);
    pop();

    pop();
  }

  // the trailing links stick out well behind the collision circle
  getDisplayBoundingBox() {
    const r = this.size + 60;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** Shackles closing on whoever the binding caught. */
export class Morgana_Q_Snap extends SpellObject {
  target: any = null;
  position = this.owner.position.copy();
  age = 0;
  lifeTime = 520;
  maxRadius = 90;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.target) this.position.set(this.target.position.x, this.target.position.y);
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const [cr, cg, cb] = BINDING_COLOR;
    const bodySize = this.target ? this.target.animatedValues.displaySize : 40;

    push();
    translate(this.position.x, this.position.y);

    // two rings collapsing inwards and locking onto the victim
    noFill();
    for (let i = 0; i < 2; i++) {
      const phase = constrain(t * 1.6 - i * 0.25, 0, 1);
      const size = lerp(this.maxRadius * 2, bodySize + 14, phase);
      stroke(45, 10, 70, 200 * fade);
      strokeWeight(7);
      circle(0, 0, size);
      stroke(cr, cg, cb, 235 * fade);
      strokeWeight(3);
      circle(0, 0, size);
    }

    // links jolting outward off the impact
    stroke(cr, cg, cb, 220 * fade);
    strokeWeight(3);
    const burst = 18 + t * 60;
    for (let i = 0; i < 8; i++) {
      const a = (i * TWO_PI) / 8 + t * 0.8;
      line(cos(a) * burst * 0.55, sin(a) * burst * 0.55, cos(a) * burst, sin(a) * burst);
    }

    // dark flash right at the moment of the bind
    const flash = 1 - constrain(t / 0.28, 0, 1);
    if (flash > 0) {
      noStroke();
      fill(cr, cg, cb, 170 * flash);
      circle(0, 0, bodySize + 30 * flash);
      fill(255, 240, 255, 200 * flash);
      circle(0, 0, (bodySize + 10) * flash * 0.55);
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.maxRadius + 30;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
