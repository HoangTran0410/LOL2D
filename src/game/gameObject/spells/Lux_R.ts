import Spell from '../Spell';
import SpellObject from '../SpellObject';
import RootBuff from '../buffs/Root';
import { rectToVertices } from '../../../utils/index';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import CollideUtils from '../../../utils/collide.utils';
import { Circle, Rectangle } from '../../../../libs/quadtree';
import { PredefinedFilters } from '../../managers/ObjectManager';

export default class Lux_R extends Spell {
  name = 'Cầu Vồng Tối Thượng (Lux_R)';
  image = AssetManager.getAsset('spell_lux_r');
  description =
    'Tích tụ năng lượng trong <span class="time">1 giây</span> rồi bắn một dải sáng dài theo hướng chỉ định. Gây <span class="damage">30 sát thương</span> và <span class="buff">Trói Chân</span> các kẻ địch trúng chiêu trong <span class="time">1 giây</span>';
  coolDown = 10000;
  manaCost = 50;

  onSpellCast() {
    const prepairTime = 1000;
    const fireTime = 500;
    const rayLength = 1000;
    const rayWidth = 50;
    const stunTime = 1000;

    const { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      rayLength
    );

    const obj = new Lux_R_Object(this.owner);
    obj.destination = destination;
    obj.rayWidth = rayWidth;
    obj.prepairTime = prepairTime;
    obj.fireTime = fireTime;
    obj.stunTime = stunTime;

    this.game.objectManager.addObject(obj);

    const buff = new RootBuff(prepairTime + fireTime, this.owner, this.owner);
    buff.image = this.image;
    this.owner.addBuff(buff);
  }
}

export class Lux_R_Object extends SpellObject {
  static PHASES = {
    PREPAIR: 0,
    FIRE: 1,
  } as const;
  phase: (typeof Lux_R_Object.PHASES)[keyof typeof Lux_R_Object.PHASES] =
    Lux_R_Object.PHASES.PREPAIR;

  destination = this.owner.position.copy();
  rayWidth = 50;

  prepairRayWidth = 0;
  prepairTime = 1000;
  timeSincePrepair = 0;

  fireTime = 400;
  timeSinceFire = 0;
  playersEffected: any[] = [];
  stunTime = 500;

  update() {
    if (this.phase === Lux_R_Object.PHASES.PREPAIR) {
      this.prepairRayWidth = this.rayWidth * (this.timeSincePrepair / this.prepairTime);

      this.timeSincePrepair += deltaTime;
      if (this.timeSincePrepair > this.prepairTime) {
        this.phase = Lux_R_Object.PHASES.FIRE;
      }
    } else if (this.phase === Lux_R_Object.PHASES.FIRE) {
      this.timeSinceFire += deltaTime;
      if (this.timeSinceFire > this.fireTime) {
        this.toRemove = true;
      }

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.destination.dist(this.owner.position),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.playersEffected),
          (o: any) => {
            const dir = this.destination.copy().sub(this.owner.position).normalize();
            const angle = dir.heading();
            const rx = this.owner.position.x;
            const ry = this.owner.position.y - this.prepairRayWidth / 2 - o.stats.size.value / 2;
            const rw = this.destination.dist(this.owner.position);
            const rh = this.prepairRayWidth + o.stats.size.value;
            const vertices = rectToVertices(rx, ry, rw, rh, angle, {
              x: this.owner.position.x,
              y: this.owner.position.y,
            });

            const px = o.position.x;
            const py = o.position.y;

            return CollideUtils.pointPolygon(px, py, vertices);
          },
        ],
      });

      enemies.forEach((enemy: any) => {
        const stun = new RootBuff(this.stunTime, this.owner, enemy);
        stun.image = AssetManager.getAsset('spell_lux_r');
        enemy.addBuff(stun);
        enemy.takeDamage(30, this.owner);

        this.playersEffected.push(enemy);
      });
    }
  }

  draw() {
    const angle = VectorUtils.getAngle(this.owner.position, this.destination);

    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(angle);

    if (this.phase === Lux_R_Object.PHASES.PREPAIR) {
      noFill();
      stroke(200, 150);
      rect(
        0,
        -this.prepairRayWidth / 2,
        this.destination.dist(this.owner.position),
        this.prepairRayWidth
      );
    } else if (this.phase === Lux_R_Object.PHASES.FIRE) {
      const len = this.destination.dist(this.owner.position);

      const alpha = map(this.timeSinceFire, 0, this.fireTime, 255, 0);
      const rayWidth = map(this.timeSinceFire, 0, this.fireTime, this.rayWidth, 10);
      stroke(255, alpha);
      for (let i = 0; i < 10; i++) {
        const x1 = random(0, len);
        const y1 = random(-rayWidth / 2, rayWidth / 2);
        const x2 = random(0, len);
        const y2 = random(-rayWidth / 2, rayWidth / 2);
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
