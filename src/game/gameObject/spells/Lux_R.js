import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';
import { rectToVertices } from '../../../utils/index.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import CollideUtils from '../../../utils/collide.utils.js';
import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import AttackableUnit from '../attackableUnits/AttackableUnit.js';

export default class Lux_R extends Spell {
  name = 'Cầu Vồng Tối Thượng (Lux_R)';
  image = AssetManager.getAsset('spell_lux_r');
  description =
    'Tích tụ năng lượng trong <span class="time">1 giây</span> rồi bắn một dải sáng dài theo hướng chỉ định. Gây <span class="damage">30 sát thương</span> và <span class="buff">Trói Chân</span> các kẻ địch trúng chiêu trong <span class="time">1 giây</span>';
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const prepairTime = 1000,
      fireTime = 500,
      rayLength = 1000,
      rayWidth = 50,
      stunTime = 1000;

    let { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      rayLength
    );

    let obj = new Lux_R_Object(this.owner);
    obj.destination = destination;
    obj.rayWidth = rayWidth;
    obj.prepairTime = prepairTime;
    obj.fireTime = fireTime;
    obj.stunTime = stunTime;

    this.game.objectManager.addObject(obj);

    // owner cannot move while casting
    let buff = new RootBuff(prepairTime + fireTime, this.owner, this.owner);
    buff.image = this.image;
    this.owner.addBuff(buff);
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
      let enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.destination.dist(this.owner.position),
        }),
        filters: [
          PredefinedFilters.includeTypes([AttackableUnit]),
          PredefinedFilters.excludeTeamIds([this.owner.teamId]),
          PredefinedFilters.excludeObjects(this.playersEffected),
          o => {
            // get vertices
            let dir = this.destination.copy().sub(this.owner.position).normalize();
            let angle = dir.heading();
            let rx = this.owner.position.x;
            let ry = this.owner.position.y - this.prepairRayWidth / 2 - o.stats.size.value / 2;
            let rw = this.destination.dist(this.owner.position);
            let rh = this.prepairRayWidth + o.stats.size.value; // increase ray width to fit enemy size
            let vertices = rectToVertices(rx, ry, rw, rh, angle, {
              x: this.owner.position.x,
              y: this.owner.position.y,
            });

            // get px, py
            let px = o.position.x;
            let py = o.position.y;

            // check collision
            return CollideUtils.pointPolygon(px, py, vertices);
          },
        ],
      });

      enemies.forEach(enemy => {
        // stun buff for enemy
        let stun = new RootBuff(this.stunTime, this.owner, enemy);
        stun.image = AssetManager.getAsset('spell_lux_r');
        enemy.addBuff(stun);
        enemy.takeDamage(30, this.owner);

        this.playersEffected.push(enemy);
      });
    }
  }

  draw() {
    let angle = VectorUtils.getAngle(this.owner.position, this.destination);

    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(angle);

    // prepair phase
    if (this.phase === Lux_R_Object.PHASES.PREPAIR) {
      // draw a rect, width = prepairRayWidth, height = distance to destination, rotate to destination
      noFill();
      stroke(200, 150);
      rect(
        0,
        -this.prepairRayWidth / 2,
        this.destination.dist(this.owner.position),
        this.prepairRayWidth
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
        let x1 = random(0, len);
        let y1 = random(-rayWidth / 2, rayWidth / 2);
        let x2 = random(0, len);
        let y2 = random(-rayWidth / 2, rayWidth / 2);
        strokeWeight(random(3, 10));
        line(x1, y1, x2, y2);
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: Math.min(this.owner.position.x, this.destination.x) - this.rayWidth / 2,
      y: Math.min(this.owner.position.y, this.destination.y) - this.rayWidth / 2,
      w: Math.abs(this.owner.position.x - this.destination.x) + this.rayWidth,
      h: Math.abs(this.owner.position.y - this.destination.y) + this.rayWidth,
      data: this,
    });
  }
}
