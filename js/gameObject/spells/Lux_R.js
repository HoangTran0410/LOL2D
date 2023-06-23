import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatsModifier } from '../Stats.js';

export default class Lux_R extends Spell {
  image = ASSETS.Spells.lux_r;
  description =
    'Sau khi tích tụ năng lượng trong 1 giây, Lux bắn một dải sáng theo hướng chỉ định, rộng 100px, dài 1000px. Chưa nghĩ ra hiệu ứng áp dụng lên kẻ địch :)';
  coolDown = 5000;

  onSpellCast() {
    const prepairTime = 1000;
    const fireTime = 400;
    const rayLength = 1000;
    const rayWidth = 50;

    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let dir = mouse.copy().sub(this.owner.position).normalize();
    let dest = dir.setMag(rayLength).add(this.owner.position);

    let obj = new Lux_R_Object(this.owner);
    obj.destination = dest;
    obj.rayWidth = rayWidth;
    obj.prepairTime = prepairTime;
    obj.fireTime = fireTime;

    this.game.objects.push(obj);

    // stun buff for owner
    this.owner.addBuff(new Lux_R_Buff(prepairTime + fireTime, this.owner, this.owner));
  }

  onUpdate() {}
}

export class Lux_R_Buff extends Buff {
  buffAddType = BuffAddType.REPLACE_EXISTING;
  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.baseValue = -this.targetUnit.stats.speed.baseValue; // slow 100%
  }
  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }
  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
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
