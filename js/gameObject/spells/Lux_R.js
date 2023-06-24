import ASSETS from '../../../assets/index.js';
import { collideRotatedRectVsPoint } from '../../utils/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';
import { Lux_Q_Buff } from './Lux_Q.js';
import Silence from '../buffs/Silence.js';

export default class Lux_R extends Spell {
  name = 'Cầu Vồng Tối Thượng (Lux_R)';
  image = ASSETS.Spells.lux_r;
  description =
    'Sau khi tích tụ năng lượng trong 1 giây, Lux bắn một dải sáng theo hướng chỉ định, rộng 100px, dài 1000px. Trói chân kẻ địch trong 1 giây.';
  coolDown = 5000;

  onSpellCast() {
    const prepairTime = 1000;
    const fireTime = 400;
    const rayLength = 1000;
    const rayWidth = 50;
    const stunTime = 1000;

    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let dir = mouse.copy().sub(this.owner.position).normalize();
    let dest = dir.setMag(rayLength).add(this.owner.position);

    let obj = new Lux_R_Object(this.owner);
    obj.destination = dest;
    obj.rayWidth = rayWidth;
    obj.prepairTime = prepairTime;
    obj.fireTime = fireTime;
    obj.stunTime = stunTime;

    this.game.objects.push(obj);

    // stun buff for owner
    this.owner.addBuff(new RootBuff(prepairTime + fireTime, this.owner, this.owner));
  }

  onUpdate() {}
}

export class Lux_R_Object extends SpellObject {
  static PHASES = {
    PREPAIR: 0,
    FIRE: 1,
  };
  phase = Lux_R_Object.PHASES.PREPAIR;

  destination = this.owner.position.copy();
  rayWidth = 50;

  // prepair phase
  prepairRayWidth = 0;
  prepairTime = 1000;
  timeSincePrepair = 0;

  // fire phase
  fireTime = 400;
  timeSinceFire = 0;
  playersEffected = [];
  stunTime = 500;

  update() {
    // prepaire phase
    if (this.phase === Lux_R_Object.PHASES.PREPAIR) {
      this.prepairRayWidth = this.rayWidth * (this.timeSincePrepair / this.prepairTime);

      this.timeSincePrepair += deltaTime;
      if (this.timeSincePrepair > this.prepairTime) {
        this.phase = Lux_R_Object.PHASES.FIRE;
      }
    }

    // fire phase
    else if (this.phase === Lux_R_Object.PHASES.FIRE) {
      this.timeSinceFire += deltaTime;
      if (this.timeSinceFire > this.fireTime) {
        this.toRemove = true;
      }

      // check collision ray-enemy
      for (let p of this.game.players) {
        if (p === this.owner) continue;
        if (this.playersEffected.includes(p)) continue;

        // get rx, ry, rw, rh, angle
        let rx = this.owner.position.x - this.rayWidth / 2;
        let ry = this.owner.position.y;
        let rw = this.rayWidth + p.stats.size.value / 2;
        let rh = this.destination.dist(this.owner.position);
        let angle = this.destination.copy().sub(this.owner.position).heading() - HALF_PI;

        // get px, py
        let px = p.position.x;
        let py = p.position.y;

        // check collision
        if (collideRotatedRectVsPoint(rx, ry, rw, rh, angle, px, py)) {
          // stun and silence buff for enemy
          let stun = new Lux_Q_Buff(this.stunTime, this.owner, p);
          stun.image = ASSETS.Spells.lux_r;
          p.addBuff(stun);
          // p.addBuff(new Silence(2000, this.owner, p));
          this.playersEffected.push(p);
        }
      }
    }
  }

  draw() {
    let dir = this.destination.copy().sub(this.owner.position).normalize();
    let angle = dir.heading() - HALF_PI;

    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(angle);

    // prepair phase
    if (this.phase === Lux_R_Object.PHASES.PREPAIR) {
      // draw a rect, width = prepairRayWidth, height = distance to destination, rotate to destination
      noFill();
      stroke(200, 150);
      rect(
        -this.prepairRayWidth / 2,
        0,
        this.prepairRayWidth,
        this.destination.dist(this.owner.position)
      );
    }

    // fire phase
    else if (this.phase === Lux_R_Object.PHASES.FIRE) {
      let len = this.destination.dist(this.owner.position);
      noStroke();
      fill(255, 100);
      rect(-this.rayWidth / 2, 0, this.rayWidth, len);

      // draw random lines with random position to make it look like a laser
      for (let i = 0; i < 30; i++) {
        let x1 = random(-this.rayWidth / 2, this.rayWidth / 2);
        let y1 = random(0, len);
        let x2 = random(-this.rayWidth / 2, this.rayWidth / 2);
        let y2 = random(0, len);
        stroke(255, 200);
        strokeWeight(random(3, 10));
        line(x1, y1, x2, y2);
      }
    }
    pop();
  }
}
