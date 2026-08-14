import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Spell from '../Spell';
import MissileSpellObject from '../MissileSpellObject';
import Slow from '../buffs/Slow';
import VectorUtils from '../../../utils/vector.utils';
import TrailSystem from '../helpers/TrailSystem';

export default class Ashe_W extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_ashe_w');
  name = 'Tán Xạ Tiễn (Ashe_W)';
  description =
    'Bắn ra <span>10 mũi tên</span> theo hình nón. Mỗi mũi tên gây <span class="damage">5 sát thương</span> và <span class="buff">Làm Chậm 75%</span> kẻ địch trúng chiêu trong <span class="time">1.5 giây</span>';
  coolDown = 5000;

  onSpellCast() {
    let mouse = this.aimPoint;
    let direction = mouse.sub(this.owner.position).normalize();

    let arrowCount = 15;
    let arrowLength = 500;
    let angle = direction.heading();
    let angleStep = Math.PI / (arrowCount * 2);

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

      this.game.objectManager.addObject(obj);
    }
  }
}

export class Ashe_W_Object extends MissileSpellObject {
  speed = 7;
  size = 10;
  maxHitCount = 1;

  trailSystem = new TrailSystem({
    maxLength: 10,
    trailSize: this.size,
    trailColor: [100, 100, 200, 50] as any,
  });

  onArrive() {
    // cut the trail immediately rather than letting it fade out on its own
    if (this.trailSystem) this.trailSystem.toRemove = true;
  }

  onHit(enemy: any) {
    let slowBuff = new Slow(1500, this.owner, enemy);
    slowBuff.percent = 0.75;
    slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
    enemy.addBuff(slowBuff);
    enemy.takeDamage(5, this.owner);
  }

  draw() {
    let alpha = Math.min(this.position.dist(this.destination), 200) + 50;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    noStroke();
    fill(39, 98, 180, alpha);
    rect(-10, -this.size / 2, 25, this.size);

    // draw triangle at head of arrow
    stroke(200, alpha);
    triangle(15, -this.size / 2, 30, 0, 15, this.size / 2);

    pop();
  }
}
