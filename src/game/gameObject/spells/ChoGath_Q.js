import { Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Slow from '../buffs/Slow.js';

export default class ChoGath_Q extends Spell {
  image = AssetManager.getAsset('spell_chogath_q');
  name = "Rạn Nứt (Cho'Gath_Q)";
  description =
    'Tạo một vụ địa chấn tại vùng đã chọn, gây <span class="damage">15 sát thương</span> và <span class="buff">Hất Tung</span> các kẻ địch trong <span class="time">1 giây</span> và <span class="buff">Làm Chậm 60%</span> chúng trong <span class="time">1.5 giây</span>';
  coolDown = 7000;

  maxRange = 400;

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();
    let position = mouse
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, mouse.dist(this.owner.position)))
      .add(this.owner.position);

    let obj = new ChoGath_Q_Object(this.owner);
    obj.position = position;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class ChoGath_Q_Object extends SpellObject {
  position = this.owner.position.copy();
  size = 140;
  expandSize = 200;
  damage = 20;
  visionRadius = this.size;
  prepareTime = 700;
  lifeTime = 1100;
  age = 0;

  affected = false;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }

    if (this.age >= this.prepareTime) {
      if (!this.affected) {
        let enemies = this.game.queryPlayersInRange({
          position: this.position,
          range: this.size / 2,
          includePlayerSize: true,
          excludeTeamIds: [this.owner.teamId],
        });

        enemies.forEach(enemy => {
          let airborneBuff = new Airborne(1000, this.owner, enemy);
          enemy.addBuff(airborneBuff);

          let slowBuff = new Slow(1500, this.owner, enemy);
          slowBuff.percent = 0.6;
          slowBuff.image = AssetManager.getAsset('spell_chogath_q');
          enemy.addBuff(slowBuff);
          enemy.takeDamage(this.damage, this.owner);
        });

        this.affected = true;
      }

      this.size = Math.min(this.size + 3, this.expandSize);
    }
  }

  draw() {
    push();
    if (this.age < this.prepareTime) {
      // draw shaking circle
      let pos = this.position.copy().add(random(-5, 5), random(-5, 5));
      let alpha = map(this.age, 0, this.prepareTime, 0, 200);
      fill(200, 100, 80, alpha);
      stroke(200, 100, 80);
      circle(pos.x, pos.y, this.size);
    } else {
      // draw circle
      let alpha = map(this.age, this.prepareTime, this.lifeTime, 200, 50);
      fill(200, 100, 80, alpha);
      stroke(200, 100, 80, alpha + 50);
      circle(this.position.x, this.position.y, this.size);

      for (let i = 0; i < 3; i++) {
        let dir = p5.Vector.random2D();
        let pos = this.position.copy().add(dir.mult(random(0, this.size / 2)));
        let size = random(10, 30);
        stroke(150, alpha);
        circle(pos.x, pos.y, size);
      }
    }
    pop();
  }

  getBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
