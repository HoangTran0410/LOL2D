import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Slow from '../buffs/Slow.js';
import VectorUtils from '../../../utils/vector.utils.js';

export default class Ashe_W extends Spell {
  image = AssetManager.getAsset('spell_ashe_w');
  name = 'Tán Xạ Tiễn (Ashe_W)';
  description =
    'Bắn ra 10 mũi tên theo hình nón, mỗi mũi tên gây 5 sát thương làm chậm kẻ địch trúng chiêu đi 75% trong 1.5s và gây 5 sát thương mỗi mũi tên.';
  coolDown = 5000;

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();
    let direction = mouse.sub(this.owner.position).normalize();

    let arrowCount = 10;
    let arrowLength = 500;
    let angle = direction.heading();
    let angleStep = Math.PI / 20;

    for (let i = 0; i < arrowCount; i++) {
      let _angle = angle - (angleStep * arrowCount) / 2 + angleStep * i;
      let { from, to } = VectorUtils.getVectorWithAngleAndRange(
        this.owner.position,
        _angle,
        arrowLength
      );

      let obj = new Ashe_W_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.direction = p5.Vector.fromAngle(_angle);

      this.game.objects.push(obj);
    }
  }
}

export class Ashe_W_Buff extends Slow {
  image = AssetManager.getAsset('spell_ashe_w');
  buffAddType = BuffAddType.RENEW_EXISTING;
  percent = 0.75;
}

export class Ashe_W_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  destination = createVector();
  direction = createVector();
  speed = 7;
  size = 10;

  update() {
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

    if (this.position.dist(this.destination) < this.speed) {
      this.toRemove = true;
    }

    let enemy = this.game.queryPlayerInRange({
      position: this.position,
      range: this.size / 2,
      includePlayerSize: true,
      excludePlayers: [this.owner],
      getOnlyOne: true,
    });

    if (enemy) {
      enemy.addBuff(new Ashe_W_Buff(1500, this.owner, enemy));
      enemy.takeDamage(5, this.owner);
      this.toRemove = true;
    }
  }

  draw() {
    let alpha = Math.min(this.position.dist(this.destination), 200) + 50;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    noStroke();
    fill(39, 98, 180, alpha);
    rect(-10, 0, 25, this.size);

    // draw triangle at head of arrow
    stroke(200, alpha);
    triangle(15, 0, 30, this.size / 2, 15, this.size);

    pop();
  }
}
