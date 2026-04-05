import { Circle, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import VectorUtils from '../../../utils/vector.utils';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class Malphite_R extends Spell {
  image = AssetManager.getAsset('spell_malphite_r');
  name = 'Không Thể Cản Phá (Malphite_R)';
  description =
    '<span class="buff">Lướt</span> tới khu vực chỉ định với tốc độ cao, gây <span class="damage">30 sát thương</span> và <span class="buff">Hất Tung</span> các kẻ địch trong <span class="time">1 giây</span> xung quanh điểm đến. <i>(Không thể cản phá bởi các hiệu ứng khống chế)</i>';
  coolDown = 10000;

  maxRange = 350;
  hitRadius = 100;
  damage = 30;

  castCancelCheck() {
    return !this.owner.canMove;
  }

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxRange
    );

    const dashBuff = new Dash(3000, this.owner, this.owner);
    dashBuff.cancelable = false;
    dashBuff.dashDestination = to;
    dashBuff.dashSpeed = 15;
    dashBuff.onReachedDestination = () => {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.hitRadius,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        const airborneBuff = new Airborne(1000, this.owner, enemy);
        airborneBuff.image = this.image;
        enemy.addBuff(airborneBuff);

        enemy.takeDamage(this.damage, this.owner);
      });

      const obj = new Malphite_R_Object(this.owner);
      obj.hitRadius = this.hitRadius;
      this.game.objectManager.addObject(obj);
    };
    this.owner.addBuff(dashBuff);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class Malphite_R_Object extends SpellObject {
  position = this.owner.position.copy();
  lifeTime = 1000;
  age = 0;
  hitRadius = 100;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    const alpha = map(this.age, 0, this.lifeTime, 200, 0);
    strokeWeight(2);
    stroke(200, alpha);
    fill(255, 200, 150, alpha);
    circle(this.position.x, this.position.y, this.hitRadius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.hitRadius,
      y: this.position.y - this.hitRadius,
      w: this.hitRadius * 2,
      h: this.hitRadius * 2,
      data: this,
    });
  }
}
