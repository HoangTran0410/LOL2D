import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Slow from '../buffs/Slow.js';

export default class ChoGath_Q extends Spell {
  image = AssetManager.getAsset('spell_chogath_q');
  name = "Rạn Nứt (Cho'Gath_Q)";
  description =
    'Tạo một vụ địa chấn tại vùng đã chọn sau một khoảng 0.7 giây trễ, Hất tung icon hất tung kẻ địch trúng phải trong 1 giây, Chậm chúng đi 60% trong 1.5 giây, gây 15 sát thương';
  coolDown = 7000;

  maxRange = 400;
  size = 140;
  expandSize = 200;
  damage = 20;

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();
    let position = mouse
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, mouse.dist(this.owner.position)))
      .add(this.owner.position);

    let obj = new ChoGath_Q_Object(this.owner);
    obj.size = this.size;
    obj.damage = this.damage;
    obj.position = position;
    obj.expandSize = this.expandSize;
    this.game.addSpellObject(obj);
  }

  drawPreview() {
    push();
    noFill();
    stroke(200, 100);
    circle(this.owner.position.x, this.owner.position.y, this.maxRange * 2);
    pop();
  }
}

export class ChoGath_Q_Slow_Buff extends Slow {
  image = AssetManager.getAsset('spell_chogath_q');
  percent = 0.6;
}

export class ChoGath_Q_Object extends SpellObject {
  position = this.owner.position.copy();
  size = 120;
  expandSize = 150;
  prepareTime = 700;
  lifeTime = 1100;
  age = 0;
  damage = 20;

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
          excludePlayers: [this.owner],
        });

        enemies.forEach(enemy => {
          let airborneBuff = new Airborne(1000, this.owner, enemy);
          enemy.addBuff(airborneBuff);
          enemy.addBuff(new ChoGath_Q_Slow_Buff(1500, this.owner, enemy));
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
}
