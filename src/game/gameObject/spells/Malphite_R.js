import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';

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
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxRange
    );

    let dashBuff = new Dash(3000, this.owner, this.owner);
    dashBuff.cancelable = false;
    dashBuff.dashDestination = to;
    dashBuff.dashSpeed = 15;
    dashBuff.onReachedDestination = () => {
      let enemies = this.game.queryPlayersInRange({
        position: this.owner.position,
        range: this.hitRadius,
        excludeTeamIds: [this.owner.teamId],
        includePlayerSize: true,
      });

      enemies.forEach(enemy => {
        let airborneBuff = new Airborne(1000, this.owner, enemy);
        airborneBuff.image = this.image;
        enemy.addBuff(airborneBuff);

        enemy.takeDamage(this.damage, this.owner);
      });

      let obj = new Malphite_R_Object(this.owner);
      obj.hitRadius = this.hitRadius;
      this.game.objectManager.addObject(obj);
    };
    this.owner.addBuff(dashBuff);

    // dash effect
    // let dashEffect = new ParticleSystem({
    //   isDeadFn: p => p.opacity <= 0,
    //   updateFn: p => {
    //     p.opacity -= 1;
    //     p.radius += 0.2;
    //   },
    //   drawFn: p => {
    //     strokeWeight(2);
    //     stroke(255, 255, 255, p.opacity);
    //     noFill();
    //     circle(p.position.x, p.position.y, p.radius * 2);
    //   },
    // });
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
    let alpha = map(this.age, 0, this.lifeTime, 200, 0);
    strokeWeight(2);
    stroke(200, alpha);
    fill(255, 200, 150, alpha);
    circle(this.position.x, this.position.y, this.hitRadius * 2);
    pop();
  }
}
