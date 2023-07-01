import ASSETS from '../../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';
import { rectToVertices, collidePolygonPoint } from '../../../utils/index.js';
import SOUNDS, { playSound } from '../../../../sounds/index.js';

export default class Lux_R extends Spell {
  name = 'Cầu Vồng Tối Thượng (Lux_R)';
  image = ASSETS.Spells.lux_r;
  description =
    'Sau khi tích tụ năng lượng trong 1 giây, Lux bắn một dải sáng theo hướng chỉ định. Trói chân kẻ địch trong 1 giây. Gây 30 sát thương';
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const prepairTime = 1000,
      fireTime = 500,
      rayLength = 800,
      rayWidth = 50,
      stunTime = 1000;

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
    let buff = new RootBuff(prepairTime + fireTime, this.owner, this.owner);
    buff.image = ASSETS.Spells.lux_r;
    this.owner.addBuff(buff);

    playSound(SOUNDS.lux_r1);
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
        playSound(SOUNDS.lux_r2);
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
        if (p.isDead || p === this.owner || this.playersEffected.includes(p)) continue;

        // get vertices
        let dir = this.destination.copy().sub(this.owner.position).normalize();
        let angle = dir.heading();
        let rx = this.owner.position.x;
        let ry = this.owner.position.y - this.prepairRayWidth / 2 - p.stats.size.value / 2;
        let rw = this.destination.copy().sub(this.owner.position).mag();
        let rh = this.prepairRayWidth + p.stats.size.value; // increase ray width to fit enemy size
        let vertices = rectToVertices(rx, ry, rw, rh, angle, {
          x: this.owner.position.x,
          y: this.owner.position.y,
        });

        // get px, py
        let px = p.position.x;
        let py = p.position.y;

        // check collision
        if (collidePolygonPoint(vertices, px, py)) {
          // stun buff for enemy
          let stun = new RootBuff(this.stunTime, this.owner, p);
          stun.image = ASSETS.Spells.lux_r;
          p.addBuff(stun);
          p.takeDamage(30, this.owner);

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

      // draw random lines with random position to make it look like a laser
      let alpha = map(this.timeSinceFire, 0, this.fireTime, 255, 0);
      let rayWidth = map(this.timeSinceFire, 0, this.fireTime, this.rayWidth, 10);
      stroke(255, alpha);
      for (let i = 0; i < 10; i++) {
        let x1 = random(-rayWidth / 2, rayWidth / 2);
        let y1 = random(0, len);
        let x2 = random(-rayWidth / 2, rayWidth / 2);
        let y2 = random(0, len);
        strokeWeight(random(3, 10));
        line(x1, y1, x2, y2);
      }
    }
    pop();
  }
}
