import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class Nasus_Q extends Spell {
  image = AssetManager.getAsset('spell_nasus_q');
  name = 'Chém Hủy Diệt (Nasus_Q)';
  description =
    'Chém kẻ địch gần nhất trong phạm vi <span>150px</span>, gây <span class="damage">25 sát thương</span>. Mỗi lần chém trúng, sát thương của chiêu này <span class="buff">vĩnh viễn tăng thêm 5</span>';
  coolDown = 3000;
  manaCost = 10;
  willDrawPreview = true;

  range = 150;
  baseDamage = 25;
  damagePerStack = 5;
  /** Grows by one every time the strike connects; never resets. */
  stacks = 0;

  checkCastCondition() {
    return !!this._findNearestEnemy();
  }

  onSpellCast() {
    const target = this._findNearestEnemy();
    if (!target) return;

    target.takeDamage(this.baseDamage + this.stacks * this.damagePerStack, this.owner);
    this.stacks++;

    const obj = new Nasus_Q_Object(this.owner);
    obj.targetPosition = target.position.copy();
    obj.angle = VectorUtils.getAngle(this.owner.position, target.position);
    this.game.objectManager.addObject(obj);
  }

  _findNearestEnemy() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = this.owner.position.dist(enemy.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = enemy;
      }
    }
    return nearest;
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Nasus_Q_Object extends SpellObject {
  targetPosition: p5.Vector = this.owner.position.copy();
  angle = 0;
  size = 90;
  lifeTime = 350;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    const t = this.age / this.lifeTime;
    const diameter = this.size * (0.6 + t * 0.7);

    push();
    translate(this.targetPosition.x, this.targetPosition.y);
    rotate(this.angle);

    noFill();
    stroke(255, 210, 130, 230 * (1 - t));
    strokeWeight(7 * (1 - t) + 2);
    arc(0, 0, diameter, diameter, -PI / 3, PI / 3);

    stroke(255, 255, 220, 180 * (1 - t));
    strokeWeight(2);
    arc(0, 0, diameter * 0.8, diameter * 0.8, -PI / 4, PI / 4);

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.targetPosition.x - this.size,
      y: this.targetPosition.y - this.size,
      w: this.size * 2,
      h: this.size * 2,
      data: this,
    });
  }
}
